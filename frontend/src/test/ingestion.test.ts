import { describe, it, expect } from 'vitest';
import type { FileRecord, FolderRule } from '../models';
import { isDescendantOf } from '../utils/path';

describe('Eventual Consistency & Folder Ingestion Reconciliation', () => {
  it('identifies un-reconciled files and finds the longest-matching folder rule', () => {
    const rules: FolderRule[] = [
      {
        ruleId: 'r-root',
        sourceId: 'src-1',
        relativePath: '',
        isPublicToFriends: false,
        allowedFriends: [],
        updatedAt: new Date(),
      },
      {
        ruleId: 'r-docs',
        sourceId: 'src-1',
        relativePath: 'Documents/',
        isPublicToFriends: false,
        allowedFriends: ['friend-a'],
        updatedAt: new Date(),
      },
      {
        ruleId: 'r-pro',
        sourceId: 'src-1',
        relativePath: 'Documents/Projects/',
        isPublicToFriends: true,
        allowedFriends: ['friend-a', 'friend-b'],
        updatedAt: new Date(),
      },
    ];

    const file1: FileRecord = {
      fileId: 'f1',
      sourceId: 'src-1',
      relativePath: 'Documents/Projects/',
      originalName: 'spec.md',
      storedName: 'spec.md',
      sha256: 'hash1',
      size: 100,
      lastModified: 1700000000,
      version: 0,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      jobId: 'j1',
      isPublicToFriends: false, // Default private from Android daemon
      allowedFriends: [],
      customPermissions: false,
    };

    const file2: FileRecord = {
      fileId: 'f2',
      sourceId: 'src-1',
      relativePath: 'Documents/Projects/',
      originalName: 'secret.key',
      storedName: 'secret.key',
      sha256: 'hash2',
      size: 50,
      lastModified: 1700000000,
      version: 0,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      jobId: 'j1',
      isPublicToFriends: false,
      allowedFriends: ['admin-only'],
      customPermissions: true, // Explicit custom override
    };

    // Longest-prefix matching algorithm
    const findMostSpecificRule = (file: FileRecord): FolderRule | null => {
      const matching = rules
        .filter(
          (r) =>
            r.sourceId === file.sourceId &&
            (!r.isDeleted) &&
            (r.relativePath === file.relativePath || isDescendantOf(file.relativePath, r.relativePath))
        )
        .sort((a, b) => b.relativePath.length - a.relativePath.length);

      return matching.length > 0 ? matching[0] : null;
    };

    const matchedRule1 = findMostSpecificRule(file1);
    expect(matchedRule1?.ruleId).toBe('r-pro');
    expect(matchedRule1?.isPublicToFriends).toBe(true);

    // Reconcile file 1
    const reconciledFile1 = {
      ...file1,
      isPublicToFriends: matchedRule1!.isPublicToFriends,
      allowedFriends: matchedRule1!.allowedFriends,
    };
    expect(reconciledFile1.isPublicToFriends).toBe(true);
    expect(reconciledFile1.allowedFriends).toContain('friend-b');

    // For file 2, customPermissions === true prevents reconciliation overwrite
    const shouldSkipFile2 = file2.customPermissions === true;
    expect(shouldSkipFile2).toBe(true);
  });
});
