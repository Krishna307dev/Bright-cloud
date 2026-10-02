import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultService } from '../services/firestore/vaultService';
import * as firestoreModule from 'firebase/firestore';

vi.mock('../services/firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'admin-1',
      email: 'krishna23902@gmail.com',
      displayName: 'Krishna Sharma',
    },
  },
  VAULT_ID: 'default',
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
    setDoc: vi.fn().mockResolvedValue(undefined),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    runTransaction: vi.fn(),
  };
});

describe('User Management Resilience and Fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listUsers succeeds even if vaults/{vaultId}/users query throws permission-denied', async () => {
    // Mock getDoc on settings/config returning valid config
    vi.spyOn(firestoreModule, 'getDoc').mockImplementation(async (_ref: any) => {
      return {
        exists: () => true,
        data: () => ({
          vaultId: 'default',
          adminUids: ['admin-1'],
          authorizedFriends: ['friend-1'],
          friendDirectory: {
            'admin-1': { label: 'Krishna Sharma', email: 'krishna23902@gmail.com', addedAt: '2026-01-01' },
            'friend-1': { label: 'Friend User', email: 'friend@example.com', addedAt: '2026-01-01' },
          },
        }),
      } as any;
    });

    // Mock getDocs on users collection throwing Missing or insufficient permissions
    vi.spyOn(firestoreModule, 'getDocs').mockImplementation(async () => {
      const err = new Error('Missing or insufficient permissions.');
      (err as any).code = 'permission-denied';
      throw err;
    });

    // Call listUsers
    const users = await VaultService.listUsers('default');

    // Should NOT throw, but return users from settings/config
    expect(users).toBeDefined();
    expect(users.length).toBe(2);

    const admin = users.find((u) => u.uid === 'admin-1');
    expect(admin).toBeDefined();
    expect(admin?.role).toBe('admin');
    expect(admin?.email).toBe('krishna23902@gmail.com');

    const friend = users.find((u) => u.uid === 'friend-1');
    expect(friend).toBeDefined();
    expect(friend?.role).toBe('friend');
    expect(friend?.email).toBe('friend@example.com');
  });

  it('listUsers merges users from users subcollection when permitted', async () => {
    vi.spyOn(firestoreModule, 'getDoc').mockImplementation(async () => {
      return {
        exists: () => true,
        data: () => ({
          vaultId: 'default',
          adminUids: ['admin-1'],
          authorizedFriends: [],
          friendDirectory: {},
        }),
      } as any;
    });

    vi.spyOn(firestoreModule, 'getDocs').mockImplementation(async () => {
      return {
        docs: [
          {
            id: 'admin-1',
            data: () => ({
              email: 'krishna23902@gmail.com',
              displayName: 'Krishna Sharma',
              role: 'admin',
              lastLogin: new Date(),
            }),
          },
          {
            id: 'pending-1',
            data: () => ({
              email: 'pending@example.com',
              displayName: 'Pending User',
              role: 'pending',
              lastLogin: new Date(),
            }),
          },
        ],
      } as any;
    });

    const users = await VaultService.listUsers('default');
    expect(users.length).toBe(2);
    expect(users.some((u) => u.uid === 'pending-1' && u.role === 'pending')).toBe(true);
  });
});
