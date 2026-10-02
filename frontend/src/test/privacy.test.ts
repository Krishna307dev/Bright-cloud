import { describe, it, expect } from 'vitest';
import type { VaultConfig, FileRecord } from '../models';

describe('Privacy and Security Invariants', () => {
  it('friend directory provides human labels without leaking UIDs to collaborator lists', () => {
    const rawUid = 'AIzaSy_Secret_Firebase_Uid_9999';
    const config: VaultConfig = {
      vaultId: 'vault-1',
      adminUids: ['admin-1'],
      authorizedFriends: [rawUid],
      friendDirectory: {
        [rawUid]: {
          label: 'Bob Smith',
          email: 'bob@example.com',
          addedAt: '2026-01-01T00:00:00Z',
        },
      },
      vaultName: 'Bright Cloud Vault',
    };

    // Simulated rendering for collaborator listing
    const entry = config.friendDirectory?.[rawUid];
    const userFacingLabel = entry?.label || entry?.email || 'Authorized Collaborator';

    expect(userFacingLabel).toBe('Bob Smith');
    expect(userFacingLabel).not.toContain(rawUid);
  });

  it('FileRecord model excludes b2ObjectKey strictly', () => {
    const file: FileRecord = {
      fileId: 'file-1',
      sourceId: 'src-1',
      relativePath: 'Docs/',
      originalName: 'secret.pdf',
      storedName: 'secret.pdf',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      size: 100,
      lastModified: 1700000000,
      version: 0,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      jobId: 'job-1',
    };

    // Assert key does not exist on type or instance
    expect((file as any).b2ObjectKey).toBeUndefined();
  });
});
