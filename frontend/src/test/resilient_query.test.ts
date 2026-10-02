import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService } from '../services/firestore/fileService';
import * as firestoreModule from 'firebase/firestore';

vi.mock('../services/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'user-1' } },
  B2_AUTHORIZER_URL: 'http://localhost:8787',
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
    limit: vi.fn().mockReturnValue({}),
    startAfter: vi.fn().mockReturnValue({}),
    getDocs: vi.fn(),
    serverTimestamp: vi.fn().mockReturnValue(new Date()),
    runTransaction: vi.fn().mockImplementation(async (_db, cb) =>
      cb({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ ruleVersion: 1, propagationId: 'prop-1', rulesGeneration: 1 }),
        }),
        set: vi.fn(),
        update: vi.fn(),
      })
    ),
  };
});

describe('Resilient Query & Missing-Index Fallback Pagination', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listAdminFolderFiles catches index error and falls back to full-set deterministic sort', async () => {
    // 1st call throws index error
    // 2nd call (fallback) returns full list unordered
    let callCount = 0;
    const mockFilesUnsorted = [
      { id: 'f2', data: () => ({ originalName: 'zebra.pdf', size: 10, relativePath: '' }) },
      { id: 'f1', data: () => ({ originalName: 'apple.pdf', size: 20, relativePath: '' }) },
      { id: 'f3', data: () => ({ originalName: 'banana.pdf', size: 30, relativePath: '' }) },
    ];

    vi.spyOn(firestoreModule, 'getDocs').mockImplementation(async (_q: any) => {
      callCount++;
      if (callCount === 1) {
        const indexErr = new Error('The query requires an index.');
        (indexErr as any).code = 'failed-precondition';
        throw indexErr;
      }
      return {
        docs: mockFilesUnsorted,
      } as any;
    });

    const result = await FileService.listAdminFolderFiles('vault-1', 'src-1', '', null, 2);

    expect(result.isFallback).toBe(true);
    // Verifies deterministic in-memory sort: apple.pdf, then banana.pdf
    expect(result.files).toHaveLength(2);
    expect(result.files[0].originalName).toBe('apple.pdf');
    expect(result.files[1].originalName).toBe('banana.pdf');
    expect(result.hasMore).toBe(true);
  });

  it('fetchFriendFolderFiles catches index error and executes separate authorized equality queries', async () => {
    let callCount = 0;
    const mockPublicFiles = [
      { id: 'p1', data: () => ({ originalName: 'public-doc.pdf', isPublicToFriends: true }) },
    ];
    const mockSharedFiles = [
      { id: 's1', data: () => ({ originalName: 'shared-doc.pdf', allowedFriends: ['user-1'] }) },
    ];

    vi.spyOn(firestoreModule, 'getDocs').mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        // Initial dual-stream queries with orderBy fail on missing index
        const indexErr = new Error('requires an index');
        throw indexErr;
      }
      // Fallback queries: return public and shared files
      if (callCount === 3) {
        return { docs: mockPublicFiles } as any;
      }
      return { docs: mockSharedFiles } as any;
    });

    const state = {
      lastPublicDoc: null,
      lastFriendDoc: null,
      publicHasMore: true,
      friendHasMore: true,
      fileMap: new Map(),
    };

    const files = await FileService.fetchFriendFolderFiles(
      'vault-1',
      'src-1',
      '',
      'user-1',
      state,
      50
    );

    // Merged and deterministically sorted
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.originalName).sort()).toEqual([
      'public-doc.pdf',
      'shared-doc.pdf',
    ]);
  });

  it('propagateFolderPermissions queries by sourceId only without composite index range constraints', async () => {
    const { PropagationEngine } = await import('../services/firestore/propagationEngine');

    const whereSpy = vi.spyOn(firestoreModule, 'where');
    vi.spyOn(firestoreModule, 'getDocs').mockResolvedValue({ docs: [] } as any);
    vi.spyOn(PropagationEngine, 'listActiveRulesForSource').mockResolvedValue([]);

    await PropagationEngine.propagateFolderPermissions(
      'vault-1',
      'src-1',
      'Documents/',
      { isPublicToFriends: true, allowedFriends: [] },
      {
        ruleId: 'src-1__Documents%2F',
        ruleVersion: 1,
        propagationId: 'prop-1',
        rulesGeneration: 1,
      }
    );

    // Verify where('sourceId', '==', 'src-1') was called
    expect(whereSpy).toHaveBeenCalledWith('sourceId', '==', 'src-1');
    // Verify no range query on relativePath was passed
    const whereCalls = whereSpy.mock.calls;
    const hasRelativePathRange = whereCalls.some(
      (c: any[]) => c[0] === 'relativePath' && (c[1] === '>=' || c[1] === '<')
    );
    expect(hasRelativePathRange).toBe(false);
  });
});
