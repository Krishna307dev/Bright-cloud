import { describe, it, expect } from 'vitest';
import type { FileRecord } from '../models';

describe('Pagination & Dual-Query Deduplication', () => {
  const createFile = (id: string, name: string, isPublic: boolean, allowed: string[] = []): FileRecord => ({
    fileId: id,
    sourceId: 'src-1',
    relativePath: 'Docs/',
    originalName: name,
    storedName: name,
    sha256: 'a'.repeat(64),
    size: 1024,
    lastModified: 1700000000,
    version: 0,
    status: 'UPLOADED',
    uploadedAt: new Date('2026-01-01T12:00:00Z'),
    jobId: 'job-1',
    isPublicToFriends: isPublic,
    allowedFriends: allowed,
  });

  it('deduplicates overlapping files between public and friend queries', () => {
    // A file that is both isPublicToFriends = true AND explicitly in allowedFriends
    const overlappingFile = createFile('file-overlap', 'Project.pdf', true, ['friend-123']);
    const publicOnlyFile = createFile('file-pub', 'Public.pdf', true, []);
    const friendOnlyFile = createFile('file-friend', 'PrivateShare.pdf', false, ['friend-123']);

    // Public query returns [overlappingFile, publicOnlyFile]
    const streamA = [overlappingFile, publicOnlyFile];
    // Friend query returns [overlappingFile, friendOnlyFile]
    const streamB = [overlappingFile, friendOnlyFile];

    // Client-side merge into Map
    const fileMap = new Map<string, FileRecord>();
    streamA.forEach((f) => fileMap.set(f.fileId, f));
    streamB.forEach((f) => fileMap.set(f.fileId, f));

    const merged = Array.from(fileMap.values());

    // Exactly 3 unique files, 0 duplicates
    expect(merged.length).toBe(3);
    expect(fileMap.has('file-overlap')).toBe(true);
    expect(fileMap.has('file-pub')).toBe(true);
    expect(fileMap.has('file-friend')).toBe(true);
  });

  it('deterministic ordering with identical filenames using documentId tie-breaker', () => {
    // 3 files with identical originalName "report.pdf" but distinct file IDs
    const f1 = createFile('doc-alpha', 'report.pdf', true);
    const f2 = createFile('doc-beta', 'report.pdf', true);
    const f3 = createFile('doc-gamma', 'report.pdf', true);

    const files = [f3, f1, f2];

    // Sorter simulating: orderBy('originalName', 'asc').orderBy(documentId(), 'asc')
    files.sort((a, b) => {
      const cmp = a.originalName.localeCompare(b.originalName);
      if (cmp !== 0) return cmp;
      return a.fileId.localeCompare(b.fileId);
    });

    expect(files[0].fileId).toBe('doc-alpha');
    expect(files[1].fileId).toBe('doc-beta');
    expect(files[2].fileId).toBe('doc-gamma');
  });
});
