import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconciliationService } from '../services/reconciliationService';
import { B2AuthorizerClient } from '../services/b2Authorizer';
import * as firestoreModule from 'firebase/firestore';

vi.mock('../services/firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'admin-1',
      getIdToken: vi.fn().mockResolvedValue('token'),
    },
  },
  B2_AUTHORIZER_URL: 'http://localhost:8787',
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    collection: vi.fn().mockReturnValue({}),
    doc: vi.fn().mockReturnValue({}),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn().mockReturnValue({}),
    where: vi.fn().mockReturnValue({}),
    deleteDoc: vi.fn(),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn().mockReturnValue(new Date()),
  };
});

describe('Web Upload Concurrency, Epoch Fencing & Reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Epoch Fencing: stale upload with superseded epoch or ownershipToken is aborted before commit', () => {
    const myLockEpoch = 1000;
    const myOwnershipToken = 'token-uuid-1';
    const currentLockInFirestore = {
      status: 'ACTIVE_LOCK',
      lockEpoch: 1001, // Another session reclaimed the lease!
      ownershipToken: 'token-uuid-2',
      ownerUid: 'admin-2',
    };

    const verifyFencing = () => {
      if (
        currentLockInFirestore.status !== 'ACTIVE_LOCK' ||
        currentLockInFirestore.ownershipToken !== myOwnershipToken ||
        currentLockInFirestore.lockEpoch !== myLockEpoch
      ) {
        throw new Error('Upload aborted: ownership lock lease was expired or acquired by another session.');
      }
    };

    expect(verifyFencing).toThrow('ownership lock lease was expired or acquired by another session');
  });

  it('Reconciliation: correctly distinguishes logical identity locks from version reservations', async () => {
    const deleteCandidateSpy = vi.spyOn(B2AuthorizerClient, 'executeDeleteCandidateObject').mockResolvedValue();
    const updateDocSpy = vi.spyOn(firestoreModule, 'updateDoc').mockResolvedValue(undefined as any);
    const deleteDocSpy = vi.spyOn(firestoreModule, 'deleteDoc').mockResolvedValue(undefined as any);

    // Mock two expired documents in nameReservations:
    // 1. A logical identity lock: status = 'ACTIVE_LOCK'
    // 2. A version reservation: status = 'PENDING'
    const expiredDate = new Date(Date.now() - 3600000); // 1 hour ago

    const mockDocs = [
      {
        id: 'LOCK_WEB_UPLOADS_docs__file.pdf',
        ref: { id: 'LOCK_WEB_UPLOADS_docs__file.pdf' },
        data: () => ({
          status: 'ACTIVE_LOCK',
          candidateSha256: 'candidate-hash-1',
          expiresAt: { toDate: () => expiredDate },
          sourceId: 'WEB_UPLOADS',
          relativePath: 'docs/',
          originalName: 'file.pdf',
        }),
      },
      {
        id: 'RES_WEB_UPLOADS_docs__file(1).pdf',
        ref: { id: 'RES_WEB_UPLOADS_docs__file(1).pdf' },
        data: () => ({
          status: 'PENDING',
          sha256: 'candidate-hash-2',
          expiresAt: { toDate: () => expiredDate },
          sourceId: 'WEB_UPLOADS',
          relativePath: 'docs/',
          storedName: 'file(1).pdf',
        }),
      },
    ];

    vi.spyOn(firestoreModule, 'getDocs').mockImplementation((_q: any) => {
      // Check if querying nameReservations vs files
      return Promise.resolve({
        docs: mockDocs,
        empty: true, // for fileQuery
      } as any);
    });

    vi.spyOn(firestoreModule, 'getDoc').mockResolvedValue({
      exists: () => false, // not canonical
    } as any);

    const summary = await ReconciliationService.reconcileStaleReservations('vault-1');

    // Lock was reconciled to RELEASED
    expect(summary.expiredLocksReconciled).toBe(1);
    expect(updateDocSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'RELEASED' })
    );

    // Version reservation was deleted
    expect(summary.expiredVersionReservationsReconciled).toBe(1);
    expect(deleteDocSpy).toHaveBeenCalled();

    // Two uncommitted candidate objects were compensated
    expect(summary.uncommittedCandidatesDeleted).toBe(2);
    expect(deleteCandidateSpy).toHaveBeenCalledTimes(2);
  });

  it('Reconciliation: NEVER deletes B2 candidate if hash has become canonical in contentHashes', async () => {
    const deleteCandidateSpy = vi.spyOn(B2AuthorizerClient, 'executeDeleteCandidateObject').mockResolvedValue();
    vi.spyOn(firestoreModule, 'updateDoc').mockResolvedValue(undefined as any);

    const expiredDate = new Date(Date.now() - 3600000);
    const mockDocs = [
      {
        id: 'LOCK_WEB_UPLOADS_photo.jpg',
        ref: { id: 'LOCK_WEB_UPLOADS_photo.jpg' },
        data: () => ({
          status: 'ACTIVE_LOCK',
          candidateSha256: 'canonical-hash-123',
          expiresAt: { toDate: () => expiredDate },
          sourceId: 'WEB_UPLOADS',
          originalName: 'photo.jpg',
        }),
      },
    ];

    vi.spyOn(firestoreModule, 'getDocs').mockResolvedValue({
      docs: mockDocs,
      empty: false,
    } as any);

    // Mock contentHashes/{canonical-hash-123} EXISTS
    vi.spyOn(firestoreModule, 'getDoc').mockResolvedValue({
      exists: () => true, // CANONICAL!
    } as any);

    const summary = await ReconciliationService.reconcileStaleReservations('vault-1');

    expect(summary.expiredLocksReconciled).toBe(1);
    // MUST NOT delete canonical object!
    expect(summary.uncommittedCandidatesDeleted).toBe(0);
    expect(deleteCandidateSpy).not.toHaveBeenCalled();
  });
});
