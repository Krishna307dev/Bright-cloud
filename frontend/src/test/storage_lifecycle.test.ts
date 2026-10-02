import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService } from '../services/firestore/fileService';
import { B2AuthorizerClient } from '../services/b2Authorizer';
import * as firestoreModule from 'firebase/firestore';

vi.mock('../services/firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'test-admin-uid',
      getIdToken: vi.fn().mockResolvedValue('test-token'),
    },
  },
  B2_AUTHORIZER_URL: 'http://localhost:8787',
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    doc: vi.fn().mockReturnValue({}),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => null }),
    deleteDoc: vi.fn(),
    updateDoc: vi.fn(),
    increment: vi.fn().mockReturnValue({}),
  };
});

describe('Storage Lifecycle & Content-Addressable Storage (CAS) Invariants', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(firestoreModule, 'getDoc').mockResolvedValue({ exists: () => false, data: () => null } as any);
  });

  it('I-001 / I-002: Logical Vault Removal deletes file metadata but NEVER issues B2 delete for canonical CAS object', async () => {
    const deleteDocSpy = vi.spyOn(firestoreModule, 'deleteDoc').mockResolvedValue(undefined as any);
    const updateDocSpy = vi.spyOn(firestoreModule, 'updateDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'doc').mockReturnValue({} as any);
    const deleteAuthSpy = vi.spyOn(B2AuthorizerClient, 'executeDeleteCandidateObject');

    await FileService.removeFileFromVault('vault-123', 'file-456', 'src-789');

    // 1. Verifies firestore deleteDoc was called on files/file-456
    expect(deleteDocSpy).toHaveBeenCalledTimes(1);

    // 2. Verifies source counter was decremented
    expect(updateDocSpy).toHaveBeenCalledTimes(1);

    // 3. Strict Invariant: B2 delete-authorize is NEVER called for a canonical file removal
    expect(deleteAuthSpy).not.toHaveBeenCalled();
  });

  it('Scenario B: Multiple files sharing same SHA retain canonical storage when one is removed', async () => {
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    // File A and File B share sha256
    const fileA = {
      fileId: 'file-A',
      sourceId: 'src-1',
      relativePath: 'photos/',
      originalName: 'pic.jpg',
      sha256,
    };
    const fileB = {
      fileId: 'file-B',
      sourceId: 'src-2',
      relativePath: 'backup/',
      originalName: 'image.jpg',
      sha256,
    };

    expect(fileB.sha256).toBe(fileA.sha256);

    const deleteDocSpy = vi.spyOn(firestoreModule, 'deleteDoc').mockResolvedValue(undefined as any);
    const deleteAuthSpy = vi.spyOn(B2AuthorizerClient, 'executeDeleteCandidateObject');

    // Remove File A
    await FileService.removeFileFromVault('vault-1', fileA.fileId, fileA.sourceId);

    // File A metadata is deleted
    expect(deleteDocSpy).toHaveBeenCalled();

    // Canonical CAS storage is retained for File B!
    expect(deleteAuthSpy).not.toHaveBeenCalled();
  });

  it('Candidate Compensation: /b2/delete-authorize is dispatched ONLY for uncommitted candidate objects', async () => {
    const candidateKey = 'backups/vault-1/WEB_UPLOADS/test.pdf';

    globalThis.fetch = vi.fn().mockImplementation((url, _opts) => {
      if (url.includes('/b2/delete-authorize')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            deleteUrl: 'https://s3.us-west-004.backblazeb2.com/test.pdf?sig=123',
            method: 'DELETE',
            expiresAt: Date.now() + 3600000,
            headers: {},
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 204 });
    });

    await B2AuthorizerClient.executeDeleteCandidateObject(candidateKey);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/b2/delete-authorize'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ objectKey: candidateKey }),
      })
    );
  });
});
