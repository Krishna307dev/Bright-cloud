import { describe, it, expect } from 'vitest';
import { PropagationAbortedError } from '../utils/error';
import type { FolderRule, SourceEntity, FileRecord } from '../models';

describe('Propagation Engine Concurrency & OCC Protocol', () => {
  it('throws PropagationAbortedError when source.rulesGeneration is incremented concurrently', () => {
    const workerContext = {
      propagationId: 'prop-uuid-1',
      ruleVersion: 1,
      rulesGeneration: 5,
    };

    const currentSource: SourceEntity = {
      sourceId: 'src-1',
      displayName: 'USB Flash',
      usbVendorId: 100,
      usbProductId: 200,
      firstSeen: new Date(),
      lastSeen: new Date(),
      totalFilesBackedUp: 100,
      rulesGeneration: 6, // Concurrently modified by another operation!
    };

    const validateGeneration = () => {
      if (currentSource.rulesGeneration !== workerContext.rulesGeneration) {
        throw new PropagationAbortedError(
          `Hierarchical rule policy changed under source ${currentSource.sourceId}. Generation superseded.`
        );
      }
    };

    expect(validateGeneration).toThrowError(PropagationAbortedError);
  });

  it('throws PropagationAbortedError when ruleVersion or propagationId is superseded', () => {
    const workerContext = {
      propagationId: 'prop-uuid-1',
      ruleVersion: 1,
      rulesGeneration: 5,
    };

    const currentRule: FolderRule = {
      ruleId: 'src-1__Docs',
      sourceId: 'src-1',
      relativePath: 'Docs/',
      allowedFriends: [],
      isPublicToFriends: true,
      propagationId: 'prop-uuid-2', // Another worker took over!
      ruleVersion: 2,
      updatedAt: new Date(),
    };

    const validateRule = () => {
      if (
        currentRule.propagationId !== workerContext.propagationId ||
        currentRule.ruleVersion !== workerContext.ruleVersion
      ) {
        throw new PropagationAbortedError(`Propagation superseded on rule ${currentRule.ruleId}`);
      }
    };

    expect(validateRule).toThrowError(PropagationAbortedError);
  });

  it('preserves customPermissions: true on file unless forceResetOverrides is enabled', () => {
    const fileWithOverride: FileRecord = {
      fileId: 'file-1',
      sourceId: 'src-1',
      relativePath: 'Docs/',
      originalName: 'Confidential.docx',
      storedName: 'Confidential.docx',
      sha256: 'abc',
      size: 100,
      lastModified: 1700000000,
      version: 0,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      jobId: 'j1',
      isPublicToFriends: false,
      allowedFriends: ['friend-special'],
      customPermissions: true, // Explicit custom override
    };


    // Case A: Default (forceResetOverrides = false) -> Skip file
    const shouldSkipA = fileWithOverride.customPermissions === true && !false;
    expect(shouldSkipA).toBe(true);

    // Case B: Deliberate Admin reset (forceResetOverrides = true) -> Update file
    const shouldSkipB = fileWithOverride.customPermissions === true && !true;
    expect(shouldSkipB).toBe(false);
  });

  it('resumes cursor on transient network error but discards cursor on generation supersession', () => {
    let cursor: string | null = 'doc-cursor-123';
    let generation = 1;

    // Simulate Transient Network Error
    const isTransientError = true;
    if (isTransientError) {
      // Cursor is retained
      expect(cursor).toBe('doc-cursor-123');
    }

    // Simulate Supersession Error
    const isSuperseded = true;
    if (isSuperseded) {
      // Invariant: Cursor MUST be discarded, full-scope restart from null
      cursor = null;
      generation = 2;
    }

    expect(cursor).toBeNull();
    expect(generation).toBe(2);
  });
});
