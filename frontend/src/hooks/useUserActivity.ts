import { useState, useEffect, useCallback, useMemo } from 'react';
import type { DocumentSnapshot } from 'firebase/firestore';
import { ActivityService } from '../services/firestore/activityService';
import type {
  UserActivityEvent,
  UserActivityFilterState,
  UserActivitySummary,
  UserSummaryRecord,
} from '../models/userActivity';
import type { UserProfile } from '../models/user';

export const INITIAL_ACTIVITY_FILTERS: UserActivityFilterState = {
  userId: 'all',
  action: 'all',
  sourceId: 'all',
  dateRange: 'all',
  searchQuery: '',
};

export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function formatDayHeader(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) {
    return 'Today';
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export interface DayGroupedActivity {
  dateKey: string;
  dateLabel: string;
  date: Date;
  events: UserActivityEvent[];
}

export function groupEventsByDay(events: UserActivityEvent[]): DayGroupedActivity[] {
  const groupsMap = new Map<string, { label: string; date: Date; events: UserActivityEvent[] }>();

  for (const event of events) {
    const d = new Date(event.createdAt);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = formatDayHeader(d);

    if (!groupsMap.has(dateKey)) {
      groupsMap.set(dateKey, {
        label,
        date: d,
        events: [],
      });
    }
    groupsMap.get(dateKey)!.events.push(event);
  }

  // Sort groups descending by date
  return Array.from(groupsMap.entries())
    .map(([dateKey, group]) => ({
      dateKey,
      dateLabel: group.label,
      date: group.date,
      events: group.events,
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function filterEvents(
  events: UserActivityEvent[],
  filters: UserActivityFilterState
): UserActivityEvent[] {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const query = filters.searchQuery.trim().toLowerCase();

  return events.filter((e) => {
    // 1. User filter
    if (filters.userId !== 'all' && e.userId !== filters.userId) {
      return false;
    }

    // 2. Action filter
    if (filters.action !== 'all' && e.action !== filters.action) {
      return false;
    }

    // 3. Drive filter
    if (filters.sourceId !== 'all' && e.sourceId !== filters.sourceId) {
      return false;
    }

    // 4. Date range filter
    const eventTime = e.createdAt.getTime();
    if (filters.dateRange === 'today') {
      if (eventTime < todayStart.getTime()) return false;
    } else if (filters.dateRange === '7days') {
      if (eventTime < now - 7 * 24 * 60 * 60 * 1000) return false;
    } else if (filters.dateRange === '30days') {
      if (eventTime < now - 30 * 24 * 60 * 60 * 1000) return false;
    }

    // 5. Search query (matches file name or relative path)
    if (query) {
      const matchName = e.fileName.toLowerCase().includes(query);
      const matchPath = e.relativePath.toLowerCase().includes(query);
      if (!matchName && !matchPath) return false;
    }

    return true;
  });
}

export function computeActivitySummary(events: UserActivityEvent[]): UserActivitySummary {
  const activeUserSet = new Set<string>();
  const fileCounts = new Map<string, number>();

  for (const e of events) {
    if (e.userId) activeUserSet.add(e.userId);
    // Only count actual drive files for most accessed file stat (ignore system auth sessions)
    if (e.sourceId !== 'system' && (e.fileName || e.fileId)) {
      const key = e.fileName || e.fileId;
      fileCounts.set(key, (fileCounts.get(key) || 0) + 1);
    }
  }

  let mostAccessedFile: { name: string; count: number } | null = null;
  for (const [name, count] of fileCounts.entries()) {
    if (!mostAccessedFile || count > mostAccessedFile.count) {
      mostAccessedFile = { name, count };
    }
  }

  return {
    totalEvents: events.length,
    activeUsersCount: activeUserSet.size,
    mostAccessedFile,
  };
}

export function computeUserSummaries(
  allUsers: UserProfile[],
  events: UserActivityEvent[]
): UserSummaryRecord[] {
  const userMap = new Map<string, UserSummaryRecord>();

  // Initialize with all registered vault users using their authentic profile timestamps
  for (const u of allUsers) {
    userMap.set(u.uid, {
      uid: u.uid,
      displayName: u.displayName || u.email?.split('@')[0] || 'User',
      email: u.email || '',
      photoURL: u.photoURL,
      role: u.role,
      lastActive: u.lastLogin || u.createdAt || null,
      lastLogin: u.lastLogin || null,
      createdAt: u.createdAt || null,
      previewCount: 0,
      downloadCount: 0,
      openCount: 0,
      totalCount: 0,
      recentEvents: [],
    });
  }

  // Aggregate events
  for (const e of events) {
    let record = userMap.get(e.userId);
    if (!record) {
      // User might not be in the initial user list
      record = {
        uid: e.userId,
        displayName: e.userDisplayName || e.email?.split('@')[0] || 'User',
        email: e.email || '',
        lastActive: null,
        lastLogin: null,
        createdAt: null,
        previewCount: 0,
        downloadCount: 0,
        openCount: 0,
        totalCount: 0,
        recentEvents: [],
      };
      userMap.set(e.userId, record);
    }

    record.totalCount += 1;
    if (e.action === 'preview') record.previewCount += 1;
    else if (e.action === 'download') record.downloadCount += 1;
    else if (e.action === 'open') record.openCount += 1;

    if (!record.lastActive || e.createdAt.getTime() > record.lastActive.getTime()) {
      record.lastActive = e.createdAt;
    }

    record.recentEvents.push(e);
  }

  // Sort: active users (newest first) followed by users with zero activity (alphabetical by name)
  return Array.from(userMap.values()).sort((a, b) => {
    if (a.lastActive && b.lastActive) {
      return b.lastActive.getTime() - a.lastActive.getTime();
    }
    if (a.lastActive && !b.lastActive) return -1;
    if (!a.lastActive && b.lastActive) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function useUserActivity(vaultId: string | null, allVaultUsers: UserProfile[] = []) {
  const [events, setEvents] = useState<UserActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [lastDocSnapshot, setLastDocSnapshot] = useState<DocumentSnapshot | null>(null);

  const [filters, setFilters] = useState<UserActivityFilterState>(INITIAL_ACTIVITY_FILTERS);
  const [subView, setSubView] = useState<'chronological' | 'by-user'>('chronological');

  const loadInitial = useCallback(async () => {
    if (!vaultId) return;
    try {
      setIsLoading(true);
      setError(null);
      const res = await ActivityService.getUserActivity(vaultId, 50, null);
      setEvents(res.events);
      setLastDocSnapshot(res.lastDoc);
      setHasMore(res.hasMore);
    } catch (err: any) {
      setError(err?.message || 'Failed to load user activity.');
    } finally {
      setIsLoading(false);
    }
  }, [vaultId]);

  const refresh = useCallback(async () => {
    if (!vaultId) return;
    try {
      setIsRefreshing(true);
      setError(null);
      const res = await ActivityService.getUserActivity(vaultId, 50, null);
      setEvents(res.events);
      setLastDocSnapshot(res.lastDoc);
      setHasMore(res.hasMore);
    } catch (err: any) {
      setError(err?.message || 'Failed to refresh user activity.');
    } finally {
      setIsRefreshing(false);
    }
  }, [vaultId]);

  const loadMore = useCallback(async () => {
    if (!vaultId || !lastDocSnapshot || isLoadingMore || !hasMore) return;
    try {
      setIsLoadingMore(true);
      const res = await ActivityService.getUserActivity(vaultId, 50, lastDocSnapshot);
      setEvents((prev) => [...prev, ...res.events]);
      setLastDocSnapshot(res.lastDoc);
      setHasMore(res.hasMore);
    } catch (err: any) {
      setError(err?.message || 'Failed to load more activity.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [vaultId, lastDocSnapshot, isLoadingMore, hasMore]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const isFiltered = useMemo(() => {
    return (
      filters.userId !== 'all' ||
      filters.action !== 'all' ||
      filters.sourceId !== 'all' ||
      filters.dateRange !== 'all' ||
      filters.searchQuery.trim() !== ''
    );
  }, [filters]);

  const resetFilters = useCallback(() => {
    setFilters(INITIAL_ACTIVITY_FILTERS);
  }, []);

  const updateFilter = useCallback(<K extends keyof UserActivityFilterState>(
    key: K,
    value: UserActivityFilterState[K]
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Combine recorded Firestore userActivity events with historical user baseline events (sign-ins and registrations)
  const combinedEvents = useMemo(() => {
    const syntheticEvents: UserActivityEvent[] = [];
    const recordedIds = new Set(events.map((e) => e.id));

    // For each vault user, generate their baseline historical activity from user profile
    for (const u of allVaultUsers) {
      if (u.lastLogin) {
        const loginId = `login-${u.uid}`;
        if (!recordedIds.has(loginId)) {
          syntheticEvents.push({
            id: loginId,
            userId: u.uid,
            userDisplayName: u.displayName || u.email?.split('@')[0] || 'User',
            email: u.email || '',
            vaultId: vaultId || 'default',
            sourceId: 'system',
            fileId: `session-${u.uid}`,
            fileName: 'Google Sign-in session',
            relativePath: 'Authentication',
            action: 'open',
            createdAt: u.lastLogin,
            device: 'Google Authenticated Client',
          });
        }
      }

      if (u.createdAt && (!u.lastLogin || Math.abs(u.createdAt.getTime() - u.lastLogin.getTime()) > 60000)) {
        const joinId = `join-${u.uid}`;
        if (!recordedIds.has(joinId)) {
          syntheticEvents.push({
            id: joinId,
            userId: u.uid,
            userDisplayName: u.displayName || u.email?.split('@')[0] || 'User',
            email: u.email || '',
            vaultId: vaultId || 'default',
            sourceId: 'system',
            fileId: `whitelist-${u.uid}`,
            fileName: u.role === 'admin' ? 'Vault Administrator whitelisted' : 'Collaborator joined whitelist',
            relativePath: 'Vault Membership',
            action: 'open',
            createdAt: u.createdAt,
            device: 'Access Control Whitelist',
          });
        }
      }
    }

    // Merge and sort newest first
    return [...events, ...syntheticEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [events, allVaultUsers, vaultId]);

  // Filtered list of events
  const filteredEvents = useMemo(() => {
    return filterEvents(combinedEvents, filters);
  }, [combinedEvents, filters]);

  // Grouped by day
  const groupedEvents = useMemo(() => {
    return groupEventsByDay(filteredEvents);
  }, [filteredEvents]);

  // Summary strip statistics
  const summary = useMemo(() => {
    return computeActivitySummary(filteredEvents);
  }, [filteredEvents]);

  // By-user aggregated view
  const userSummaries = useMemo(() => {
    return computeUserSummaries(allVaultUsers, filteredEvents);
  }, [allVaultUsers, filteredEvents]);

  return {
    events: combinedEvents,
    filteredEvents,
    groupedEvents,
    summary,
    userSummaries,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    hasMore,
    filters,
    isFiltered,
    subView,
    setSubView,
    updateFilter,
    resetFilters,
    refresh,
    loadMore,
  };
}
