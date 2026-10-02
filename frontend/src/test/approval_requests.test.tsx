import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalService } from '../services/firestore/approvalService';
import * as firestoreModule from 'firebase/firestore';

vi.mock('../services/firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'user-unapproved-1',
      email: 'applicant@example.com',
      displayName: 'Applicant User',
    },
  },
  VAULT_ID: 'default',
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    collection: vi.fn().mockReturnValue({}),
    doc: vi.fn().mockReturnValue({}),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    serverTimestamp: vi.fn().mockReturnValue('MOCK_TIMESTAMP'),
  };
});

describe('ApprovalService Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(firestoreModule, 'doc').mockImplementation((...args: any[]) => ({ path: args.join('/') }) as any);
    vi.spyOn(firestoreModule, 'collection').mockImplementation((...args: any[]) => ({ path: args.join('/') }) as any);
    vi.spyOn(firestoreModule, 'serverTimestamp').mockReturnValue('MOCK_TIMESTAMP' as any);
    vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'updateDoc').mockResolvedValue(undefined as any);
  });

  describe('submitApprovalRequest', () => {
    it('validates required fields: name, reason, and referredBy', async () => {
      await expect(
        ApprovalService.submitApprovalRequest({
          uid: 'uid-1',
          email: 'test@example.com',
          name: '',
          reason: 'Valid reason',
          referredBy: 'Friend',
        })
      ).rejects.toThrow(/name is required/i);

      await expect(
        ApprovalService.submitApprovalRequest({
          uid: 'uid-1',
          email: 'test@example.com',
          name: 'Alice',
          reason: '',
          referredBy: 'Friend',
        })
      ).rejects.toThrow(/reason is required/i);

      await expect(
        ApprovalService.submitApprovalRequest({
          uid: 'uid-1',
          email: 'test@example.com',
          name: 'Alice',
          reason: 'Valid reason',
          referredBy: '',
        })
      ).rejects.toThrow(/who referred you/i);
    });

    it('submits a new request and trims referredBy to 100 characters', async () => {
      vi.spyOn(firestoreModule, 'getDoc').mockResolvedValueOnce({
        exists: () => false,
      } as any);

      const setDocSpy = vi.spyOn(firestoreModule, 'setDoc');

      const longReferral = 'A'.repeat(150);
      const result = await ApprovalService.submitApprovalRequest({
        uid: 'user-123',
        email: 'user123@example.com',
        name: '  Bob Dylan  ',
        reason: '  Need vault photos  ',
        referredBy: `  ${longReferral}  `,
      });

      expect(result.name).toBe('Bob Dylan');
      expect(result.reason).toBe('Need vault photos');
      expect(result.referredBy.length).toBe(100);
      expect(result.status).toBe('pending');

      expect(setDocSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          uid: 'user-123',
          email: 'user123@example.com',
          name: 'Bob Dylan',
          reason: 'Need vault photos',
          status: 'pending',
        }),
        { merge: true }
      );
    });

    it('updates existing request on resubmission without wiping original createdAt', async () => {
      const originalCreatedAt = new Date('2026-01-01T00:00:00Z');
      vi.spyOn(firestoreModule, 'getDoc').mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          uid: 'user-123',
          email: 'user123@example.com',
          name: 'Old Name',
          reason: 'Old Reason',
          referredBy: 'Old Referrer',
          createdAt: originalCreatedAt,
          status: 'pending',
        }),
      } as any);

      const setDocSpy = vi.spyOn(firestoreModule, 'setDoc');

      const result = await ApprovalService.submitApprovalRequest({
        uid: 'user-123',
        email: 'user123@example.com',
        name: 'Updated Name',
        reason: 'Updated Reason',
        referredBy: 'New Referrer',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.reason).toBe('Updated Reason');
      expect(setDocSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'Updated Name',
          createdAt: originalCreatedAt,
        }),
        { merge: true }
      );
    });
  });

  describe('getApprovalRequest and listApprovalRequests', () => {
    it('returns null if request document does not exist', async () => {
      vi.spyOn(firestoreModule, 'getDoc').mockResolvedValueOnce({
        exists: () => false,
      } as any);

      const req = await ApprovalService.getApprovalRequest('non-existent');
      expect(req).toBeNull();
    });

    it('returns approval request when doc exists', async () => {
      vi.spyOn(firestoreModule, 'getDoc').mockResolvedValueOnce({
        exists: () => true,
        id: 'user-456',
        data: () => ({
          email: 'user456@example.com',
          name: 'Charlie',
          reason: 'Research project',
          referredBy: 'Professor X',
          status: 'pending',
          createdAt: { toDate: () => new Date('2026-05-01') },
        }),
      } as any);

      const req = await ApprovalService.getApprovalRequest('user-456');
      expect(req).not.toBeNull();
      expect(req?.name).toBe('Charlie');
      expect(req?.reason).toBe('Research project');
      expect(req?.referredBy).toBe('Professor X');
    });

    it('listApprovalRequests returns map of all requests', async () => {
      vi.spyOn(firestoreModule, 'getDocs').mockResolvedValueOnce({
        docs: [
          {
            id: 'uid-1',
            data: () => ({
              email: 'u1@example.com',
              name: 'User 1',
              reason: 'Reason 1',
              referredBy: 'Friend 1',
              status: 'pending',
            }),
          },
          {
            id: 'uid-2',
            data: () => ({
              email: 'u2@example.com',
              name: 'User 2',
              reason: 'Reason 2',
              referredBy: 'Friend 2',
              status: 'approved',
            }),
          },
        ],
      } as any);

      const map = await ApprovalService.listApprovalRequests();
      expect(map.size).toBe(2);
      expect(map.get('uid-1')?.name).toBe('User 1');
      expect(map.get('uid-2')?.status).toBe('approved');
    });

    it('updateApprovalStatus calls updateDoc with new status and serverTimestamp', async () => {
      const updateDocSpy = vi.spyOn(firestoreModule, 'updateDoc');

      await ApprovalService.updateApprovalStatus('uid-1', 'approved');

      expect(updateDocSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'approved',
          updatedAt: 'MOCK_TIMESTAMP',
        })
      );
    });
  });
});
