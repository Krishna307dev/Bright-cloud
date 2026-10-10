import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { UserActivityEvent, LogAccessParams } from '../../models/userActivity';

const DEBOUNCE_WINDOW_MS = 30 * 1000; // 30 seconds debounce window

// In-memory cache for debouncing duplicate events: key -> timestamp
const debounceMap = new Map<string, number>();

/**
 * Detects device / browser family from navigator.userAgent safely.
 */
export function detectDeviceFamily(): string {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return 'Web Client';
  }
  const ua = navigator.userAgent;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  let browser = 'Browser';
  if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/Chrome/i.test(ua)) browser = 'Chrome';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Safari/i.test(ua)) browser = 'Safari';

  return isMobile ? `Mobile ${browser}` : `Desktop ${browser}`;
}

export class ActivityService {
  /**
   * Logs a user file access event (preview, download, open).
   * Fire-and-forget: does not block the caller, swallows and logs errors with console.warn.
   * Debounces duplicate events for the same (userId, fileId, action) within 30 seconds.
   */
  static async logAccess(params: LogAccessParams): Promise<void> {
    if (!params.vaultId || !params.userId || !params.fileId) {
      return;
    }

    const debounceKey = `${params.userId}:${params.fileId}:${params.action}`;
    const now = Date.now();
    const lastLogged = debounceMap.get(debounceKey);

    if (lastLogged && now - lastLogged < DEBOUNCE_WINDOW_MS) {
      // Debounced duplicate within 30 seconds
      return;
    }

    // Set debounce timestamp immediately
    debounceMap.set(debounceKey, now);

    // Housekeeping: clean entries older than 60s if map grows
    if (debounceMap.size > 200) {
      for (const [k, time] of debounceMap.entries()) {
        if (now - time > 60 * 1000) {
          debounceMap.delete(k);
        }
      }
    }

    try {
      const colRef = collection(db, 'vaults', params.vaultId, 'userActivity');
      const docPayload = {
        userId: params.userId,
        userDisplayName: params.userDisplayName || params.email?.split('@')[0] || 'User',
        email: params.email || '',
        vaultId: params.vaultId,
        sourceId: params.sourceId,
        fileId: params.fileId,
        fileName: params.fileName,
        relativePath: params.relativePath || '',
        action: params.action,
        createdAt: serverTimestamp(),
        device: params.device || detectDeviceFamily(),
      };

      await addDoc(colRef, docPayload);
    } catch (err: unknown) {
      console.warn('ActivityService.logAccess: failed to record access event', err);
    }
  }

  /**
   * Queries user activity records for a vault, ordered by createdAt DESC with cursor pagination.
   * Admin only.
   */
  static async getUserActivity(
    vaultId: string,
    pageSize = 50,
    lastDocSnapshot?: DocumentSnapshot | null
  ): Promise<{
    events: UserActivityEvent[];
    lastDoc: QueryDocumentSnapshot | null;
    hasMore: boolean;
  }> {
    const colRef = collection(db, 'vaults', vaultId, 'userActivity');

    // Fetch pageSize + 1 to determine if more pages exist
    let q = query(colRef, orderBy('createdAt', 'desc'), limit(pageSize + 1));
    if (lastDocSnapshot) {
      q = query(colRef, orderBy('createdAt', 'desc'), startAfter(lastDocSnapshot), limit(pageSize + 1));
    }

    const snapshot = await getDocs(q);
    const docs = snapshot.docs;
    const hasMore = docs.length > pageSize;
    const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;

    const events: UserActivityEvent[] = pageDocs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        userId: data.userId || '',
        userDisplayName: data.userDisplayName || 'User',
        email: data.email || '',
        vaultId: data.vaultId || vaultId,
        sourceId: data.sourceId || '',
        fileId: data.fileId || '',
        fileName: data.fileName || '',
        relativePath: data.relativePath || '',
        action: data.action || 'preview',
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now()),
        device: data.device || undefined,
      };
    });

    const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

    return {
      events,
      lastDoc,
      hasMore,
    };
  }

  /**
   * Clears in-memory debounce map for test isolation.
   */
  static _clearDebounceCacheForTesting(): void {
    debounceMap.clear();
  }

  /**
   * Returns current size of debounce map for test inspection.
   */
  static _getDebounceCacheSizeForTesting(): number {
    return debounceMap.size;
  }
}
