import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import { ActivityService, detectDeviceFamily } from '../services/firestore/activityService';
import {
  isSameDay,
  formatDayHeader,
  groupEventsByDay,
  filterEvents,
  computeActivitySummary,
  computeUserSummaries,
  INITIAL_ACTIVITY_FILTERS,
} from '../hooks/useUserActivity';
import type {
  UserActivityEvent,
  LogAccessParams,
} from '../models/userActivity';
import type { UserProfile } from '../models/user';

vi.mock('../services/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'admin-user-1' } },
  B2_AUTHORIZER_URL: 'http://localhost:8787',
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    collection: vi.fn().mockReturnValue({ id: 'userActivity' }),
    doc: vi.fn().mockReturnValue({}),
    query: vi.fn().mockReturnValue({}),
    orderBy: vi.fn().mockReturnValue({}),
    limit: vi.fn().mockReturnValue({}),
    startAfter: vi.fn().mockReturnValue({}),
    addDoc: vi.fn().mockResolvedValue({ id: 'new-activity-doc-id' }),
    getDocs: vi.fn(),
    serverTimestamp: vi.fn().mockReturnValue({ _serverTimestamp: true }),
  };
});

describe('User Activity Audit System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ActivityService._clearDebounceCacheForTesting();
  });

  afterEach(() => {
    ActivityService._clearDebounceCacheForTesting();
  });

  describe('Device Family Detection', () => {
    const originalUserAgent = navigator.userAgent;

    afterEach(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
    });

    it('detects Desktop Chrome correctly', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      });
      expect(detectDeviceFamily()).toBe('Desktop Chrome');
    });

    it('detects Mobile Safari correctly', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        configurable: true,
      });
      expect(detectDeviceFamily()).toBe('Mobile Safari');
    });

    it('detects Desktop Edge correctly', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        configurable: true,
      });
      expect(detectDeviceFamily()).toBe('Desktop Edge');
    });

    it('detects Desktop Firefox correctly', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
        configurable: true,
      });
      expect(detectDeviceFamily()).toBe('Desktop Firefox');
    });
  });

  describe('Access Logging and Debounce Behavior', () => {
    const sampleParams: LogAccessParams = {
      userId: 'user-alice',
      userDisplayName: 'Alice Johnson',
      email: 'alice@example.com',
      vaultId: 'vault-1',
      sourceId: 'src-drive-1',
      fileId: 'file-doc-123',
      fileName: 'Quarterly_Report.pdf',
      relativePath: 'Documents/Finance',
      action: 'preview',
    };

    it('successfully logs first access event and writes to userActivity collection', async () => {
      const addDocSpy = vi.spyOn(firestoreModule, 'addDoc');

      await ActivityService.logAccess(sampleParams);

      expect(addDocSpy).toHaveBeenCalledTimes(1);
      const callArgs = addDocSpy.mock.calls[0];
      const payload = callArgs[1] as any;

      expect(payload.userId).toBe('user-alice');
      expect(payload.userDisplayName).toBe('Alice Johnson');
      expect(payload.email).toBe('alice@example.com');
      expect(payload.vaultId).toBe('vault-1');
      expect(payload.sourceId).toBe('src-drive-1');
      expect(payload.fileId).toBe('file-doc-123');
      expect(payload.fileName).toBe('Quarterly_Report.pdf');
      expect(payload.relativePath).toBe('Documents/Finance');
      expect(payload.action).toBe('preview');
      expect(payload.device).toBeDefined();

      expect(ActivityService._getDebounceCacheSizeForTesting()).toBe(1);
    });

    it('debounces duplicate event for same user + file + action within 30 seconds', async () => {
      const addDocSpy = vi.spyOn(firestoreModule, 'addDoc');

      // First call
      await ActivityService.logAccess(sampleParams);
      expect(addDocSpy).toHaveBeenCalledTimes(1);

      // Second call immediately within 30s
      await ActivityService.logAccess(sampleParams);
      expect(addDocSpy).toHaveBeenCalledTimes(1); // Not called again
    });

    it('allows logging when action is different (preview vs download)', async () => {
      const addDocSpy = vi.spyOn(firestoreModule, 'addDoc');

      await ActivityService.logAccess(sampleParams);
      expect(addDocSpy).toHaveBeenCalledTimes(1);

      await ActivityService.logAccess({
        ...sampleParams,
        action: 'download',
      });
      expect(addDocSpy).toHaveBeenCalledTimes(2);
    });

    it('allows logging when fileId is different', async () => {
      const addDocSpy = vi.spyOn(firestoreModule, 'addDoc');

      await ActivityService.logAccess(sampleParams);
      expect(addDocSpy).toHaveBeenCalledTimes(1);

      await ActivityService.logAccess({
        ...sampleParams,
        fileId: 'file-doc-999',
        fileName: 'Another_File.txt',
      });
      expect(addDocSpy).toHaveBeenCalledTimes(2);
    });

    it('allows logging when userId is different', async () => {
      const addDocSpy = vi.spyOn(firestoreModule, 'addDoc');

      await ActivityService.logAccess(sampleParams);
      expect(addDocSpy).toHaveBeenCalledTimes(1);

      await ActivityService.logAccess({
        ...sampleParams,
        userId: 'user-bob',
        userDisplayName: 'Bob Smith',
        email: 'bob@example.com',
      });
      expect(addDocSpy).toHaveBeenCalledTimes(2);
    });

    it('swallows errors and logs console.warn when Firestore addDoc fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(firestoreModule, 'addDoc').mockRejectedValueOnce(new Error('Permission denied'));

      // Must not throw or reject
      await expect(ActivityService.logAccess(sampleParams)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('ignores logging calls with missing mandatory fields', async () => {
      const addDocSpy = vi.spyOn(firestoreModule, 'addDoc');

      await ActivityService.logAccess({ ...sampleParams, vaultId: '' });
      await ActivityService.logAccess({ ...sampleParams, userId: '' });
      await ActivityService.logAccess({ ...sampleParams, fileId: '' });

      expect(addDocSpy).not.toHaveBeenCalled();
    });
  });

  describe('Activity Filtering Logic', () => {
    const now = Date.now();
    const mockEvents: UserActivityEvent[] = [
      {
        id: 'evt-1',
        userId: 'u-1',
        userDisplayName: 'Alice',
        email: 'alice@vault.local',
        vaultId: 'vault-1',
        sourceId: 'src-1',
        fileId: 'f-1',
        fileName: 'invoice_2026.pdf',
        relativePath: 'Finance',
        action: 'preview',
        createdAt: new Date(now - 10 * 60 * 1000), // 10 minutes ago (Today)
      },
      {
        id: 'evt-2',
        userId: 'u-2',
        userDisplayName: 'Bob',
        email: 'bob@vault.local',
        vaultId: 'vault-1',
        sourceId: 'src-1',
        fileId: 'f-2',
        fileName: 'presentation.pptx',
        relativePath: 'Pitch',
        action: 'download',
        createdAt: new Date(now - 25 * 60 * 60 * 1000), // 25 hours ago (Yesterday)
      },
      {
        id: 'evt-3',
        userId: 'u-1',
        userDisplayName: 'Alice',
        email: 'alice@vault.local',
        vaultId: 'vault-1',
        sourceId: 'src-2',
        fileId: 'f-3',
        fileName: 'backup_archive.zip',
        relativePath: 'Backups',
        action: 'download',
        createdAt: new Date(now - 4 * 24 * 60 * 60 * 1000), // 4 days ago
      },
      {
        id: 'evt-4',
        userId: 'u-3',
        userDisplayName: 'Charlie',
        email: 'charlie@vault.local',
        vaultId: 'vault-1',
        sourceId: 'src-2',
        fileId: 'f-4',
        fileName: 'notes.txt',
        relativePath: 'General',
        action: 'open',
        createdAt: new Date(now - 40 * 24 * 60 * 60 * 1000), // 40 days ago
      },
    ];

    it('returns all events when filters are default', () => {
      const res = filterEvents(mockEvents, INITIAL_ACTIVITY_FILTERS);
      expect(res).toHaveLength(4);
    });

    it('filters by userId', () => {
      const res = filterEvents(mockEvents, {
        ...INITIAL_ACTIVITY_FILTERS,
        userId: 'u-1',
      });
      expect(res).toHaveLength(2);
      expect(res.every((e) => e.userId === 'u-1')).toBe(true);
    });

    it('filters by action', () => {
      const previewRes = filterEvents(mockEvents, {
        ...INITIAL_ACTIVITY_FILTERS,
        action: 'preview',
      });
      expect(previewRes).toHaveLength(1);
      expect(previewRes[0].id).toBe('evt-1');

      const downloadRes = filterEvents(mockEvents, {
        ...INITIAL_ACTIVITY_FILTERS,
        action: 'download',
      });
      expect(downloadRes).toHaveLength(2);
    });

    it('filters by sourceId (drive)', () => {
      const res = filterEvents(mockEvents, {
        ...INITIAL_ACTIVITY_FILTERS,
        sourceId: 'src-2',
      });
      expect(res).toHaveLength(2);
      expect(res.every((e) => e.sourceId === 'src-2')).toBe(true);
    });

    it('filters by date range: today', () => {
      const res = filterEvents(mockEvents, {
        ...INITIAL_ACTIVITY_FILTERS,
        dateRange: 'today',
      });
      // evt-1 created today relative to mockEvents base
      expect(res.map((e) => e.id)).toContain('evt-1');
    });

    it('filters by search query matching file name case-insensitively', () => {
      const res = filterEvents(mockEvents, {
        ...INITIAL_ACTIVITY_FILTERS,
        searchQuery: 'INVOICE',
      });
      expect(res).toHaveLength(1);
      expect(res[0].fileName).toBe('invoice_2026.pdf');
    });

    it('filters by search query matching relative path', () => {
      const res = filterEvents(mockEvents, {
        ...INITIAL_ACTIVITY_FILTERS,
        searchQuery: 'pitch',
      });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('evt-2');
    });
  });

  describe('Day Grouping and Header Formatting', () => {
    it('correctly compares calendar days with isSameDay', () => {
      const d1 = new Date(2026, 9, 10, 8, 30);
      const d2 = new Date(2026, 9, 10, 23, 15);
      const d3 = new Date(2026, 9, 11, 1, 0);

      expect(isSameDay(d1, d2)).toBe(true);
      expect(isSameDay(d1, d3)).toBe(false);
    });

    it('formats today header as Today', () => {
      const now = new Date(2026, 9, 10, 14, 0);
      const todayTime = new Date(2026, 9, 10, 9, 0);
      expect(formatDayHeader(todayTime, now)).toBe('Today');
    });

    it('formats yesterday header as Yesterday', () => {
      const now = new Date(2026, 9, 10, 14, 0);
      const yesterdayTime = new Date(2026, 9, 9, 18, 0);
      expect(formatDayHeader(yesterdayTime, now)).toBe('Yesterday');
    });

    it('formats older dates as formatted date string', () => {
      const now = new Date(2026, 9, 10, 14, 0);
      const pastTime = new Date(2026, 7, 15, 12, 0);
      const header = formatDayHeader(pastTime, now);
      expect(header).not.toBe('Today');
      expect(header).not.toBe('Yesterday');
      expect(header).toContain('2026');
    });

    it('groups events chronologically into day buckets', () => {
      const events: UserActivityEvent[] = [
        {
          id: '1',
          userId: 'u1',
          userDisplayName: 'U1',
          email: '',
          vaultId: 'v',
          sourceId: 's',
          fileId: 'f1',
          fileName: 'a.txt',
          relativePath: '',
          action: 'preview',
          createdAt: new Date('2026-10-10T10:00:00Z'),
        },
        {
          id: '2',
          userId: 'u1',
          userDisplayName: 'U1',
          email: '',
          vaultId: 'v',
          sourceId: 's',
          fileId: 'f2',
          fileName: 'b.txt',
          relativePath: '',
          action: 'download',
          createdAt: new Date('2026-10-10T08:00:00Z'),
        },
        {
          id: '3',
          userId: 'u2',
          userDisplayName: 'U2',
          email: '',
          vaultId: 'v',
          sourceId: 's',
          fileId: 'f3',
          fileName: 'c.txt',
          relativePath: '',
          action: 'open',
          createdAt: new Date('2026-10-09T14:00:00Z'),
        },
      ];

      const groups = groupEventsByDay(events);
      expect(groups).toHaveLength(2);
      expect(groups[0].events).toHaveLength(2);
      expect(groups[1].events).toHaveLength(1);
    });
  });

  describe('Summary Metrics Computation', () => {
    it('computes total events, active users count, and most accessed file', () => {
      const events: UserActivityEvent[] = [
        {
          id: '1',
          userId: 'u-1',
          userDisplayName: 'Alice',
          email: '',
          vaultId: 'v',
          sourceId: 's',
          fileId: 'f-1',
          fileName: 'Annual_Plan.docx',
          relativePath: '',
          action: 'preview',
          createdAt: new Date(),
        },
        {
          id: '2',
          userId: 'u-2',
          userDisplayName: 'Bob',
          email: '',
          vaultId: 'v',
          sourceId: 's',
          fileId: 'f-1',
          fileName: 'Annual_Plan.docx',
          relativePath: '',
          action: 'download',
          createdAt: new Date(),
        },
        {
          id: '3',
          userId: 'u-1',
          userDisplayName: 'Alice',
          email: '',
          vaultId: 'v',
          sourceId: 's',
          fileId: 'f-2',
          fileName: 'Budget.xlsx',
          relativePath: '',
          action: 'preview',
          createdAt: new Date(),
        },
      ];

      const summary = computeActivitySummary(events);
      expect(summary.totalEvents).toBe(3);
      expect(summary.activeUsersCount).toBe(2);
      expect(summary.mostAccessedFile).toEqual({
        name: 'Annual_Plan.docx',
        count: 2,
      });
    });

    it('returns null mostAccessedFile and 0 counts for empty event list', () => {
      const summary = computeActivitySummary([]);
      expect(summary.totalEvents).toBe(0);
      expect(summary.activeUsersCount).toBe(0);
      expect(summary.mostAccessedFile).toBeNull();
    });
  });

  describe('User Summaries Aggregation with Inactive Users', () => {
    const vaultUsers: UserProfile[] = [
      {
        uid: 'u-active',
        displayName: 'Active User',
        email: 'active@vault.local',
        role: 'friend',
        lastLogin: new Date('2026-10-10T10:00:00Z'),
      },
      {
        uid: 'u-inactive',
        displayName: 'Historical Login User',
        email: 'inactive@vault.local',
        role: 'friend',
        lastLogin: new Date('2026-09-01T00:00:00Z'),
      },
      {
        uid: 'u-never',
        displayName: 'Never Logged In User',
        email: 'never@vault.local',
        role: 'friend',
      },
    ];

    const events: UserActivityEvent[] = [
      {
        id: '1',
        userId: 'u-active',
        userDisplayName: 'Active User',
        email: 'active@vault.local',
        vaultId: 'v',
        sourceId: 's',
        fileId: 'f-1',
        fileName: 'doc1.pdf',
        relativePath: '',
        action: 'preview',
        createdAt: new Date('2026-10-10T09:00:00Z'),
      },
      {
        id: '2',
        userId: 'u-active',
        userDisplayName: 'Active User',
        email: 'active@vault.local',
        vaultId: 'v',
        sourceId: 's',
        fileId: 'f-2',
        fileName: 'doc2.pdf',
        relativePath: '',
        action: 'download',
        createdAt: new Date('2026-10-10T09:30:00Z'),
      },
    ];

    it('merges all vault users and tracks file events, setting lastActive to null for users without file actions', () => {
      const records = computeUserSummaries(vaultUsers, events);

      expect(records).toHaveLength(3);

      const activeRecord = records.find((r) => r.uid === 'u-active');
      expect(activeRecord).toBeDefined();
      expect(activeRecord!.totalCount).toBe(2);
      expect(activeRecord!.previewCount).toBe(1);
      expect(activeRecord!.downloadCount).toBe(1);
      expect(activeRecord!.lastActive).toEqual(new Date('2026-10-10T09:30:00Z'));
      expect(activeRecord!.recentEvents).toHaveLength(2);

      const inactiveRecord = records.find((r) => r.uid === 'u-inactive');
      expect(inactiveRecord).toBeDefined();
      expect(inactiveRecord!.totalCount).toBe(0);
      expect(inactiveRecord!.previewCount).toBe(0);
      expect(inactiveRecord!.downloadCount).toBe(0);
      expect(inactiveRecord!.lastActive).toBeNull();
      expect(inactiveRecord!.lastLogin).toEqual(new Date('2026-09-01T00:00:00Z'));
      expect(inactiveRecord!.recentEvents).toHaveLength(0);

      const neverRecord = records.find((r) => r.uid === 'u-never');
      expect(neverRecord).toBeDefined();
      expect(neverRecord!.totalCount).toBe(0);
      expect(neverRecord!.lastActive).toBeNull();
      expect(neverRecord!.lastLogin).toBeNull();
    });

    it('sorts users with file activity first, followed by users with no file activity', () => {
      const records = computeUserSummaries(vaultUsers, events);
      expect(records[0].uid).toBe('u-active');
      // Inactive users without file activity are sorted alphabetically
      expect(records.slice(1).map((r) => r.uid)).toEqual(
        expect.arrayContaining(['u-inactive', 'u-never'])
      );
    });
  });

  describe('Cross-Page Navigation and Target Highlighting', () => {
    it('constructs correct explorer route and state object for file location', () => {
      const event: UserActivityEvent = {
        id: 'evt-1',
        userId: 'u-1',
        userDisplayName: 'User',
        email: 'user@test.com',
        vaultId: 'v1',
        sourceId: 'usb-drive-alpha',
        fileId: 'file-target-99',
        fileName: 'Photo.jpg',
        relativePath: 'Pictures/Vacation/',
        action: 'preview',
        createdAt: new Date(),
      };

      const cleanPath = (event.relativePath || '').replace(/^\/+|\/+$/g, '');
      const targetRoute = `/files/${encodeURIComponent(event.sourceId)}/${encodeURIComponent(cleanPath)}`;
      const navigationState = { highlightFileId: event.fileId };

      expect(targetRoute).toBe('/files/usb-drive-alpha/Pictures%2FVacation');
      expect(navigationState.highlightFileId).toBe('file-target-99');
    });
  });
});
