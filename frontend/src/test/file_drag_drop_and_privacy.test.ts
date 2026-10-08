import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileRecord } from '../models';
import {
  BRIGHTCLOUD_DRAG_MIME,
  createDragPayload,
  isSameFolder,
  checkNameCollisions,
  getFileAccessLevel,
  filterPrivateFiles,
} from '../features/files/fileOperations';
import { FileService } from '../services/firestore/fileService';

vi.mock('../services/firestore/fileService', () => ({
  FileService: {
    moveFiles: vi.fn(),
    updateFilePermissions: vi.fn(),
  },
}));

describe('File Drag & Drop and Privacy Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockFile = (overrides: Partial<FileRecord> = {}): FileRecord => ({
    fileId: 'file-1',
    sourceId: 'src-1',
    relativePath: 'Documents',
    originalName: 'report.pdf',
    storedName: 'report.pdf',
    sha256: 'abc123hash',
    size: 2048,
    lastModified: 1700000000,
    version: 0,
    status: 'UPLOADED',
    uploadedAt: new Date('2026-01-01T00:00:00Z'),
    jobId: 'job-1',
    ...overrides,
  });

  describe('Drag Payload and MIME isolation', () => {
    it('uses custom MIME type to isolate from OS file drag events', () => {
      expect(BRIGHTCLOUD_DRAG_MIME).toBe('application/x-brightcloud-files');
    });

    it('creates drag payload with fileIds, sourceId, and sourcePath', () => {
      const files = [
        mockFile({ fileId: 'f1', originalName: 'a.txt' }),
        mockFile({ fileId: 'f2', originalName: 'b.txt' }),
      ];
      const payload = createDragPayload(files, 'src-1', 'Documents');

      expect(payload.fileIds).toEqual(['f1', 'f2']);
      expect(payload.sourceId).toBe('src-1');
      expect(payload.sourcePath).toBe('Documents/');
      expect(payload.names).toEqual(['a.txt', 'b.txt']);
      expect(payload.type).toBe('brightcloud-internal-move');
    });

    it('handles empty drag payload gracefully', () => {
      const payload = createDragPayload([], 'src-1', '');
      expect(payload.fileIds).toEqual([]);
      expect(payload.names).toEqual([]);
      expect(payload.sourcePath).toBe('');
    });
  });

  describe('Folder comparison (same-folder no-op)', () => {
    it('correctly identifies identical folders regardless of slashes', () => {
      expect(isSameFolder('Documents', 'Documents')).toBe(true);
      expect(isSameFolder('/Documents/', 'Documents')).toBe(true);
      expect(isSameFolder('', '/')).toBe(true);
      expect(isSameFolder('Photos/2026', '/Photos/2026/')).toBe(true);
    });

    it('correctly identifies different folders', () => {
      expect(isSameFolder('Documents', 'Photos')).toBe(false);
      expect(isSameFolder('Documents', '')).toBe(false);
      expect(isSameFolder('Documents/Sub', 'Documents')).toBe(false);
    });
  });

  describe('Name collision detection', () => {
    it('detects collisions when target contains identical storedName or originalName', () => {
      const filesToMove = [
        mockFile({ fileId: 'f1', originalName: 'a.txt', storedName: 'a.txt' }),
        mockFile({ fileId: 'f2', originalName: 'unique.txt', storedName: 'unique.txt' }),
      ];
      const targetFiles = [
        mockFile({ fileId: 'f3', originalName: 'a.txt', storedName: 'a.txt', relativePath: 'Dest' }),
        mockFile({ fileId: 'f4', originalName: 'other.txt', storedName: 'other.txt', relativePath: 'Dest' }),
      ];

      const { canMove, collisions } = checkNameCollisions(filesToMove, targetFiles);
      expect(canMove.map((f) => f.fileId)).toEqual(['f2']);
      expect(collisions.map((f) => f.fileId)).toEqual(['f1']);
    });

    it('allows all files when no collision exists in target', () => {
      const filesToMove = [
        mockFile({ fileId: 'f1', originalName: 'a.txt', storedName: 'a.txt' }),
      ];
      const targetFiles = [
        mockFile({ fileId: 'f2', originalName: 'b.txt', storedName: 'b.txt' }),
      ];

      const { canMove, collisions } = checkNameCollisions(filesToMove, targetFiles);
      expect(canMove.length).toBe(1);
      expect(collisions.length).toBe(0);
    });
  });

  describe('Access level classification', () => {
    it('classifies public files when isPublicToFriends is true', () => {
      const file = mockFile({ isPublicToFriends: true, allowedFriends: [] });
      expect(getFileAccessLevel(file)).toBe('public');
    });

    it('classifies shared files when allowedFriends has entries and not public', () => {
      const file = mockFile({ isPublicToFriends: false, allowedFriends: ['user-123'] });
      expect(getFileAccessLevel(file)).toBe('shared');
    });

    it('classifies private files when not public and allowedFriends is empty or undefined', () => {
      const file1 = mockFile({ isPublicToFriends: false, allowedFriends: [] });
      const file2 = mockFile({ isPublicToFriends: false, allowedFriends: undefined });
      const file3 = mockFile({ isPublicToFriends: undefined, allowedFriends: [] });

      expect(getFileAccessLevel(file1)).toBe('private');
      expect(getFileAccessLevel(file2)).toBe('private');
      expect(getFileAccessLevel(file3)).toBe('private');
    });
  });

  describe('Filter private files', () => {
    it('excludes .keep placeholder files even if private', () => {
      const files = [
        mockFile({ fileId: 'f1', originalName: '.keep', isPublicToFriends: false, allowedFriends: [] }),
        mockFile({ fileId: 'f2', originalName: 'real.txt', isPublicToFriends: false, allowedFriends: [] }),
      ];

      const result = filterPrivateFiles(files);
      expect(result.length).toBe(1);
      expect(result[0].fileId).toBe('f2');
    });

    it('filters out public and shared files, retaining only private files', () => {
      const files = [
        mockFile({ fileId: 'f1', originalName: 'public.txt', isPublicToFriends: true }),
        mockFile({ fileId: 'f2', originalName: 'shared.txt', isPublicToFriends: false, allowedFriends: ['friend-1'] }),
        mockFile({ fileId: 'f3', originalName: 'private1.txt', isPublicToFriends: false, allowedFriends: [] }),
        mockFile({ fileId: 'f4', originalName: 'private2.txt', isPublicToFriends: false }),
      ];

      const result = filterPrivateFiles(files);
      expect(result.map((f) => f.fileId)).toEqual(['f3', 'f4']);
    });
  });

  describe('Permission update service calls', () => {
    it('calls FileService.updateFilePermissions with true and empty array when making public', async () => {
      vi.spyOn(FileService, 'updateFilePermissions').mockResolvedValue(undefined);

      await FileService.updateFilePermissions('vault-1', 'file-123', true, []);

      expect(FileService.updateFilePermissions).toHaveBeenCalledWith(
        'vault-1',
        'file-123',
        true,
        []
      );
    });

    it('calls FileService.updateFilePermissions with false and empty array when making private', async () => {
      vi.spyOn(FileService, 'updateFilePermissions').mockResolvedValue(undefined);

      await FileService.updateFilePermissions('vault-1', 'file-123', false, []);

      expect(FileService.updateFilePermissions).toHaveBeenCalledWith(
        'vault-1',
        'file-123',
        false,
        []
      );
    });
  });
});
