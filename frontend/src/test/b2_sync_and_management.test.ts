import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService, isSystemFileOrFolder, extractSubdirectories } from '../services/firestore/fileService';
import { B2AuthorizerClient } from '../services/b2Authorizer';
import { VaultService } from '../services/firestore/vaultService';
import * as firestoreModule from 'firebase/firestore';
import type { FileRecord } from '../models';

vi.mock('../services/firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'admin-1',
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
    },
  },
  B2_AUTHORIZER_URL: 'http://localhost:8787',
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    doc: vi.fn().mockReturnValue({}),
    collection: vi.fn().mockReturnValue({}),
    query: vi.fn().mockReturnValue({}),
    where: vi.fn().mockReturnValue({}),
    getDocs: vi.fn().mockResolvedValue({ docs: [] }),
    deleteDoc: vi.fn(),
    updateDoc: vi.fn(),
    setDoc: vi.fn(),
    getDoc: vi.fn(),
    writeBatch: vi.fn(),
    increment: vi.fn().mockReturnValue({}),
  };
});

describe('Item 2: Backblaze B2 Storage Synchronization on Move / Cut & Paste and Copy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(firestoreModule, 'doc').mockReturnValue({} as any);
    vi.spyOn(firestoreModule, 'collection').mockReturnValue({} as any);
  });

  it('moveFiles physically calls moveObject in B2 and updates relativePath & b2ObjectKey in Firestore', async () => {
    const moveObjectSpy = vi.spyOn(B2AuthorizerClient, 'moveObject').mockResolvedValue(undefined);
    const mockBatch = {
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(firestoreModule, 'writeBatch').mockReturnValue(mockBatch as any);
    vi.spyOn(firestoreModule, 'doc').mockReturnValue({} as any);

    // Mock existing file document
    vi.spyOn(firestoreModule, 'getDoc').mockResolvedValue({
      exists: () => true,
      data: () => ({
        sourceId: '1008-8195-FAC5-5D5E',
        storedName: 'sample.mp4',
        originalName: 'sample.mp4',
        relativePath: '',
        b2ObjectKey: 'backups/default/1008-8195-FAC5-5D5E/sample.mp4',
      }),
    } as any);

    await FileService.moveFiles('default', ['file-1'], 'sex/');

    // Verified: B2 moveObject was dispatched with old and new canonical keys
    expect(moveObjectSpy).toHaveBeenCalledWith(
      'backups/default/1008-8195-FAC5-5D5E/sample.mp4',
      'backups/default/1008-8195-FAC5-5D5E/sex/sample.mp4'
    );

    // Verified: Firestore batch updated both relativePath and b2ObjectKey
    expect(mockBatch.update).toHaveBeenCalledWith(
      {},
      {
        relativePath: 'sex/',
        b2ObjectKey: 'backups/default/1008-8195-FAC5-5D5E/sex/sample.mp4',
      }
    );
    expect(mockBatch.commit).toHaveBeenCalled();
  });

  it('copyFiles physically duplicates object in B2 and creates new FileRecord in Firestore', async () => {
    const copyObjectSpy = vi.spyOn(B2AuthorizerClient, 'copyObject').mockResolvedValue(undefined);
    const mockBatch = {
      set: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(firestoreModule, 'writeBatch').mockReturnValue(mockBatch as any);
    vi.spyOn(firestoreModule, 'getDocs').mockResolvedValue({ docs: [] } as any);

    const testFile: FileRecord = {
      fileId: 'file-1',
      sourceId: '1008-8195-FAC5-5D5E',
      relativePath: 'sourceDir/',
      originalName: 'report.pdf',
      storedName: 'report.pdf',
      b2ObjectKey: 'backups/default/1008-8195-FAC5-5D5E/sourceDir/report.pdf',
      sha256: 'sha-val',
      size: 1024,
      lastModified: Date.now(),
      version: 0,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      jobId: 'job-1',
    };

    await FileService.copyFiles('default', [testFile], 'targetDir/', '1008-8195-FAC5-5D5E');

    // Verified: B2 copyObject was called with source and destination B2 keys
    expect(copyObjectSpy).toHaveBeenCalledWith(
      'backups/default/1008-8195-FAC5-5D5E/sourceDir/report.pdf',
      'backups/default/1008-8195-FAC5-5D5E/targetDir/report.pdf'
    );

    // Verified: Firestore batch set created a new FileRecord with target relativePath & b2ObjectKey
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceId: '1008-8195-FAC5-5D5E',
        relativePath: 'targetDir/',
        originalName: 'report.pdf',
        storedName: 'report.pdf',
        b2ObjectKey: 'backups/default/1008-8195-FAC5-5D5E/targetDir/report.pdf',
        sha256: 'sha-val',
        status: 'UPLOADED',
      })
    );
    expect(mockBatch.commit).toHaveBeenCalled();
  });

  it('copyFiles resolves collision and copies in B2 when copying in the same folder', async () => {
    const copyObjectSpy = vi.spyOn(B2AuthorizerClient, 'copyObject').mockResolvedValue(undefined);
    const mockBatch = {
      set: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(firestoreModule, 'writeBatch').mockReturnValue(mockBatch as any);
    vi.spyOn(firestoreModule, 'getDocs').mockResolvedValue({
      docs: [
        {
          data: () => ({ originalName: 'report.pdf', storedName: 'report.pdf' }),
        },
      ],
    } as any);

    const testFile: FileRecord = {
      fileId: 'file-1',
      sourceId: '1008-8195-FAC5-5D5E',
      relativePath: 'sourceDir/',
      originalName: 'report.pdf',
      storedName: 'report.pdf',
      b2ObjectKey: 'backups/default/1008-8195-FAC5-5D5E/sourceDir/report.pdf',
      sha256: 'sha-val',
      size: 1024,
      lastModified: Date.now(),
      version: 0,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      jobId: 'job-1',
    };

    await FileService.copyFiles('default', [testFile], 'sourceDir/', '1008-8195-FAC5-5D5E');

    // Verified: Name resolved to report(1).pdf and B2 copied to the new key
    expect(copyObjectSpy).toHaveBeenCalledWith(
      'backups/default/1008-8195-FAC5-5D5E/sourceDir/report.pdf',
      'backups/default/1008-8195-FAC5-5D5E/sourceDir/report(1).pdf'
    );

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relativePath: 'sourceDir/',
        storedName: 'report(1).pdf',
        originalName: 'report(1).pdf',
        b2ObjectKey: 'backups/default/1008-8195-FAC5-5D5E/sourceDir/report(1).pdf',
      })
    );
  });
});

describe('Item 3 & 6: Multi-Select Bulk Delete & Physical B2 Deletion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deleteFiles physically deletes S3 objects from B2 and removes metadata from Firestore', async () => {
    const deleteObjectSpy = vi.spyOn(B2AuthorizerClient, 'executeDeleteObject').mockResolvedValue(undefined);
    const mockBatch = {
      delete: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(firestoreModule, 'writeBatch').mockReturnValue(mockBatch as any);
    vi.spyOn(firestoreModule, 'doc').mockReturnValue({} as any);

    const testFiles: FileRecord[] = [
      {
        fileId: 'file-1',
        sourceId: 'src-1',
        relativePath: 'Docs/',
        originalName: 'report.pdf',
        storedName: 'report.pdf',
        sha256: 'sha1',
        size: 1000,
        lastModified: 1000,
        version: 0,
        status: 'UPLOADED',
        uploadedAt: new Date(),
        jobId: 'job1',
      },
      {
        fileId: 'file-2',
        sourceId: 'src-1',
        relativePath: '',
        originalName: 'notes.txt',
        storedName: 'notes.txt',
        sha256: 'sha2',
        size: 500,
        lastModified: 1000,
        version: 0,
        status: 'UPLOADED',
        uploadedAt: new Date(),
        jobId: 'job1',
      },
    ];

    await FileService.deleteFiles('default', testFiles);

    // Verified: executeDeleteObject called for each file's canonical B2 key
    expect(deleteObjectSpy).toHaveBeenCalledWith('backups/default/src-1/Docs/report.pdf');
    expect(deleteObjectSpy).toHaveBeenCalledWith('backups/default/src-1/notes.txt');

    // Verified: Firestore batch delete called for each file
    expect(mockBatch.delete).toHaveBeenCalledTimes(2);
    expect(mockBatch.commit).toHaveBeenCalled();
  });

  it('removeFileFromVault physically deletes single file from B2', async () => {
    const deleteObjectSpy = vi.spyOn(B2AuthorizerClient, 'executeDeleteObject').mockResolvedValue(undefined);
    vi.spyOn(firestoreModule, 'deleteDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'updateDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'doc').mockReturnValue({} as any);

    await FileService.removeFileFromVault(
      'default',
      'file-99',
      'src-usb',
      'backups/default/src-usb/photos/pic.jpg'
    );

    expect(deleteObjectSpy).toHaveBeenCalledWith('backups/default/src-usb/photos/pic.jpg');
  });

  it('removeFileFromVault purges contentHashes and nameReservation when no remaining files use that sha256', async () => {
    const deleteObjectSpy = vi.spyOn(B2AuthorizerClient, 'executeDeleteObject').mockResolvedValue(undefined);
    const deleteDocSpy = vi.spyOn(firestoreModule, 'deleteDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'updateDoc').mockResolvedValue(undefined as any);

    // Mock getDoc returning file details including sha256 and storedName
    vi.spyOn(firestoreModule, 'getDoc').mockResolvedValue({
      exists: () => true,
      data: () => ({
        sourceId: 'src-usb',
        relativePath: 'photos/',
        storedName: 'pic.jpg',
        originalName: 'pic.jpg',
        sha256: 'unique-sha-12345',
        b2ObjectKey: 'backups/default/src-usb/photos/pic.jpg',
      }),
    } as any);

    // Mock getDocs query for remaining files sharing sha256 -> empty (no other files)
    vi.spyOn(firestoreModule, 'getDocs').mockResolvedValue({
      empty: true,
      docs: [],
    } as any);

    await FileService.removeFileFromVault('default', 'file-99', 'src-usb');

    expect(deleteObjectSpy).toHaveBeenCalledWith('backups/default/src-usb/photos/pic.jpg');
    // deleteDoc called for file doc, contentHashes, and nameReservation
    expect(deleteDocSpy).toHaveBeenCalledTimes(3);
  });

  it('deleteFiles purges contentHashes when no remaining files share the deleted hashes', async () => {
    vi.spyOn(B2AuthorizerClient, 'executeDeleteObject').mockResolvedValue(undefined);
    const deleteDocSpy = vi.spyOn(firestoreModule, 'deleteDoc').mockResolvedValue(undefined as any);
    const mockBatch = {
      delete: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(firestoreModule, 'writeBatch').mockReturnValue(mockBatch as any);

    // getDocs for remaining files with that hash -> empty
    vi.spyOn(firestoreModule, 'getDocs').mockResolvedValue({
      empty: true,
      docs: [],
    } as any);

    const testFiles: FileRecord[] = [
      {
        fileId: 'file-1',
        sourceId: 'src-1',
        relativePath: 'Docs/',
        originalName: 'report.pdf',
        storedName: 'report.pdf',
        sha256: 'sha-only-one',
        size: 100,
        lastModified: 100,
        version: 0,
        status: 'UPLOADED',
        uploadedAt: new Date(),
        jobId: 'job1',
      },
    ];

    await FileService.deleteFiles('default', testFiles);

    // Verified: batch deleted file doc
    expect(mockBatch.delete).toHaveBeenCalledTimes(1);
    // Verified: deleteDoc called to delete contentHashes for sha-only-one and nameReservation
    expect(deleteDocSpy).toHaveBeenCalled();
  });
});

describe('Item 4 & 5: System File & Folder Filtering', () => {
  it('correctly classifies Android system cache files and folders', () => {
    expect(isSystemFileOrFolder('.database_uuid')).toBe(true);
    expect(isSystemFileOrFolder('.thumbnails')).toBe(true);
    expect(isSystemFileOrFolder('.nomedia')).toBe(true);
    expect(isSystemFileOrFolder('.DS_Store')).toBe(true);
    expect(isSystemFileOrFolder('Thumbs.db')).toBe(true);
    expect(isSystemFileOrFolder('LOST.DIR')).toBe(true);
    expect(isSystemFileOrFolder('desktop.ini')).toBe(true);

    // Normal user files are NOT classified as system files
    expect(isSystemFileOrFolder('Music')).toBe(false);
    expect(isSystemFileOrFolder('track01.mp3')).toBe(false);
    expect(isSystemFileOrFolder('Vacation Photos')).toBe(false);
    expect(isSystemFileOrFolder('family.jpg')).toBe(false);
  });

  it('extractSubdirectories hides system folders like .thumbnails by default when showHidden is false', () => {
    const files: FileRecord[] = [
      {
        fileId: '1',
        sourceId: 'src-1',
        relativePath: 'Music/.thumbnails/',
        originalName: 'thumb1.jpg',
        storedName: 'thumb1.jpg',
        sha256: '1',
        size: 100,
        lastModified: 100,
        version: 0,
        status: 'UPLOADED',
        uploadedAt: new Date(),
        jobId: '1',
      },
      {
        fileId: '2',
        sourceId: 'src-1',
        relativePath: 'Music/Albums/',
        originalName: 'song.mp3',
        storedName: 'song.mp3',
        sha256: '2',
        size: 5000,
        lastModified: 100,
        version: 0,
        status: 'UPLOADED',
        uploadedAt: new Date(),
        jobId: '1',
      },
    ];

    // Default: showHidden = false
    const hiddenDefault = extractSubdirectories(files, 'Music/', false);
    expect(hiddenDefault.map((f) => f.name)).toEqual(['Albums']);
    expect(hiddenDefault.some((f) => f.name === '.thumbnails')).toBe(false);

    // When showHidden = true
    const hiddenShown = extractSubdirectories(files, 'Music/', true);
    expect(hiddenShown.map((f) => f.name)).toEqual(['.thumbnails', 'Albums']);
  });

  it('triggerDownload throws graceful error if B2 storage returns 404', async () => {
    vi.spyOn(B2AuthorizerClient, 'requestDownloadAuthorization').mockResolvedValue({
      downloadUrl: 'https://s3.backblazeb2.com/test-bucket/missing.pdf',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      fileId: 'f-missing',
      storedName: 'missing.pdf',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    });

    await expect(
      B2AuthorizerClient.triggerDownload('default', 'f-missing', 'missing.pdf')
    ).rejects.toThrow('File not available in cloud storage');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://s3.backblazeb2.com/test-bucket/missing.pdf',
      expect.objectContaining({
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      })
    );
  });
});

describe('Item 8: User Profile Synchronization & Role Management', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('syncUserProfile records Google user profile into vaults/{vaultId}/users/{uid}', async () => {
    const setDocSpy = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'doc').mockReturnValue({} as any);
    vi.spyOn(firestoreModule, 'getDoc').mockResolvedValue({
      exists: () => false,
      data: () => null,
    } as any);

    await VaultService.syncUserProfile(
      'default',
      {
        uid: 'google-user-123',
        email: 'krishna23902@gmail.com',
        displayName: 'Krishna',
        photoURL: 'https://example.com/photo.jpg',
      },
      'friend'
    );

    expect(setDocSpy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        uid: 'google-user-123',
        email: 'krishna23902@gmail.com',
        displayName: 'Krishna',
        role: 'friend',
      }),
      { merge: true }
    );
  });

  it('syncUserProfile preserves existing ignored role when user logs in and forcedRole is undefined', async () => {
    const setDocSpy = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'doc').mockReturnValue({} as any);

    // Mock existing user doc with role: 'ignored'
    vi.spyOn(firestoreModule, 'getDoc').mockImplementation((_ref: any) => {
      return Promise.resolve({
        exists: () => true,
        data: () => ({
          uid: 'revoked-user-99',
          email: 'revoked@example.com',
          role: 'ignored',
        }),
      } as any);
    });

    await VaultService.syncUserProfile(
      'default',
      {
        uid: 'revoked-user-99',
        email: 'revoked@example.com',
        displayName: 'Revoked User',
      }
    );

    // Verified: Role was preserved as 'ignored' instead of overwritten to 'pending'
    expect(setDocSpy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        uid: 'revoked-user-99',
        role: 'ignored',
      }),
      { merge: true }
    );
  });

  it('deleteFiles chunks operations into multiple batches when exceeding batch limit', async () => {
    vi.spyOn(B2AuthorizerClient, 'executeDeleteObject').mockResolvedValue(undefined);
    let commitCount = 0;
    const mockBatch = {
      delete: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockImplementation(() => {
        commitCount++;
        return Promise.resolve();
      }),
    };
    vi.spyOn(firestoreModule, 'writeBatch').mockReturnValue(mockBatch as any);
    vi.spyOn(firestoreModule, 'doc').mockReturnValue({} as any);

    // Create 450 test files
    const largeFileList: FileRecord[] = Array.from({ length: 450 }, (_, i) => ({
      fileId: `file-${i}`,
      sourceId: 'src-1',
      relativePath: 'Docs/',
      originalName: `file-${i}.txt`,
      storedName: `file-${i}.txt`,
      sha256: `hash-${i}`,
      size: 100,
      lastModified: 100,
      version: 0,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      jobId: 'job1',
    }));

    await FileService.deleteFiles('default', largeFileList);

    // Verified: Committed at least 2 batches because 450 > 400
    expect(commitCount).toBeGreaterThanOrEqual(2);
    expect(mockBatch.delete).toHaveBeenCalledTimes(450);
  });
});
