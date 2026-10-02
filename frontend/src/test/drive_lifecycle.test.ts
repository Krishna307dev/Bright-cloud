import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourceService } from '../services/firestore/sourceService';
import { B2AuthorizerClient } from '../services/b2Authorizer';
import * as firestoreModule from 'firebase/firestore';

vi.mock('../services/firebase', () => ({
  db: {},
}));

vi.mock('../services/b2Authorizer', () => ({
  B2AuthorizerClient: {
    executeDeleteDrive: vi.fn(),
  },
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    collection: vi.fn().mockReturnValue({}),
    doc: vi.fn().mockReturnValue({}),
    query: vi.fn().mockReturnValue({}),
    where: vi.fn().mockReturnValue({}),
    orderBy: vi.fn().mockReturnValue({}),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    writeBatch: vi.fn().mockReturnValue({
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

describe('Drive Deletion Lifecycle & 24h Undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scheduleSourceDeletion sets status to PENDING_DELETION with a 24-hour future timestamp', async () => {
    const updateSpy = vi.spyOn(firestoreModule, 'updateDoc').mockResolvedValue(undefined as any);

    const now = Date.now();
    const executeDate = await SourceService.scheduleSourceDeletion('vault-1', 'src-usb-1');

    expect(updateSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'PENDING_DELETION',
        deletionExecuteAt: expect.any(Date),
      })
    );

    // Verify 24 hour window (+/- 5 seconds)
    const diffHours = (executeDate.getTime() - now) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThanOrEqual(23.99);
    expect(diffHours).toBeLessThanOrEqual(24.01);
  });

  it('cancelSourceDeletion restores status to ACTIVE and clears deletion timestamp', async () => {
    const updateSpy = vi.spyOn(firestoreModule, 'updateDoc').mockResolvedValue(undefined as any);

    await SourceService.cancelSourceDeletion('vault-1', 'src-usb-1');

    expect(updateSpy).toHaveBeenCalledWith(
      expect.anything(),
      {
        status: 'ACTIVE',
        deletionExecuteAt: null,
      }
    );
  });

  it('executeSourceDeletion purges B2 prefix and deletes files and source document', async () => {
    const b2Spy = vi.spyOn(B2AuthorizerClient, 'executeDeleteDrive').mockResolvedValue({
      success: true,
      prefix: 'backups/vault-1/src-usb-1/',
      versionsPurged: 12,
    });
    const deleteDocSpy = vi.spyOn(firestoreModule, 'deleteDoc').mockResolvedValue(undefined as any);

    // Mock 2 files in Firestore for this source
    vi.spyOn(firestoreModule, 'getDocs').mockResolvedValue({
      empty: false,
      docs: [
        { ref: { id: 'file-1' } },
        { ref: { id: 'file-2' } },
      ],
    } as any);

    const result = await SourceService.executeSourceDeletion('vault-1', 'src-usb-1');

    expect(b2Spy).toHaveBeenCalledWith('vault-1', 'src-usb-1');
    expect(deleteDocSpy).toHaveBeenCalled();
    expect(result.b2PurgedCount).toBe(12);
    expect(result.filesDeleted).toBe(2);
  });

  it('processExpiredDeletions automatically purges drives whose 24-hour window has passed', async () => {
    const executeSourceSpy = vi.spyOn(SourceService, 'executeSourceDeletion').mockResolvedValue({
      filesDeleted: 5,
      b2PurgedCount: 5,
    });

    const expiredDate = new Date(Date.now() - 3600000); // Expired 1 hour ago
    const futureDate = new Date(Date.now() + 3600000); // 1 hour in future

    vi.spyOn(firestoreModule, 'getDocs').mockResolvedValue({
      docs: [
        {
          id: 'expired-drive-1',
          data: () => ({
            status: 'PENDING_DELETION',
            deletionExecuteAt: { toDate: () => expiredDate },
          }),
        },
        {
          id: 'active-waiting-drive-2',
          data: () => ({
            status: 'PENDING_DELETION',
            deletionExecuteAt: { toDate: () => futureDate },
          }),
        },
      ],
    } as any);

    const expiredIds = await SourceService.processExpiredDeletions('vault-1');

    expect(expiredIds).toEqual(['expired-drive-1']);
    expect(executeSourceSpy).toHaveBeenCalledTimes(1);
    expect(executeSourceSpy).toHaveBeenCalledWith('vault-1', 'expired-drive-1');
  });
});
