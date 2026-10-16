import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  deleteDoc,
  writeBatch,
  getCountFromServer,
} from 'firebase/firestore';
import { db } from '../firebase';
import { B2AuthorizerClient } from '../b2Authorizer';
import type { SourceEntity } from '../../models';

export class SourceService {
  /**
   * Lists all physical USB sources ordered by lastSeen DESC.
   * Both Admin and Authorized Friends have read permissions under firestore.rules.
   */
  static async listSources(vaultId: string): Promise<SourceEntity[]> {
    const sourcesRef = collection(db, 'vaults', vaultId, 'sources');
    const q = query(sourcesRef, orderBy('lastSeen', 'desc'));
    const snapshot = await getDocs(q);

    const result: SourceEntity[] = snapshot.docs.map(d => {
      const data = d.data();
      return {
        sourceId: data.sourceId || d.id,
        displayName: data.displayName || (d.id === 'WEB_UPLOADS' ? 'Web Uploads' : 'USB Storage Drive'),
        volumeUuid: data.volumeUuid || undefined,
        usbVendorId: data.usbVendorId || 0,
        usbProductId: data.usbProductId || 0,
        serialNumber: data.serialNumber || undefined,
        firstSeen: data.firstSeen?.toDate ? data.firstSeen.toDate() : new Date(),
        lastSeen: data.lastSeen?.toDate ? data.lastSeen.toDate() : new Date(),
        totalFilesBackedUp: data.totalFilesBackedUp || 0,
        rulesGeneration: data.rulesGeneration || 0,
        status: data.status || 'ACTIVE',
        deletionExecuteAt: data.deletionExecuteAt?.toDate ? data.deletionExecuteAt.toDate() : undefined,
      };
    });

    if (!result.some((s) => s.sourceId === 'WEB_UPLOADS')) {
      result.unshift({
        sourceId: 'WEB_UPLOADS',
        displayName: 'Web Uploads',
        volumeUuid: undefined,
        usbVendorId: 0,
        usbProductId: 0,
        serialNumber: undefined,
        firstSeen: new Date(),
        lastSeen: new Date(),
        totalFilesBackedUp: 0,
        rulesGeneration: 0,
        status: 'ACTIVE',
        deletionExecuteAt: undefined,
      });
    }

    return result;
  }

  /**
   * Fetches a single source by ID.
   */
  static async getSource(vaultId: string, sourceId: string): Promise<SourceEntity | null> {
    const sourceRef = doc(db, 'vaults', vaultId, 'sources', sourceId);
    const snap = await getDoc(sourceRef);
    if (!snap.exists()) return null;

    const data = snap.data();
    return {
      sourceId: data.sourceId || snap.id,
      displayName: data.displayName || 'USB Storage Drive',
      volumeUuid: data.volumeUuid || undefined,
      usbVendorId: data.usbVendorId || 0,
      usbProductId: data.usbProductId || 0,
      serialNumber: data.serialNumber || undefined,
      firstSeen: data.firstSeen?.toDate ? data.firstSeen.toDate() : new Date(),
      lastSeen: data.lastSeen?.toDate ? data.lastSeen.toDate() : new Date(),
      totalFilesBackedUp: data.totalFilesBackedUp || 0,
      rulesGeneration: data.rulesGeneration || 0,
      status: data.status || 'ACTIVE',
      deletionExecuteAt: data.deletionExecuteAt?.toDate ? data.deletionExecuteAt.toDate() : undefined,
    };
  }

  /**
   * Schedules a USB source drive for deletion in 24 hours.
   * State is PENDING_DELETION; all underlying files remain accessible and safe during this window.
   */
  static async scheduleSourceDeletion(vaultId: string, sourceId: string): Promise<Date> {
    const executionDate = new Date(Date.now() + 24 * 3600 * 1000);
    const sourceRef = doc(db, 'vaults', vaultId, 'sources', sourceId);
    await updateDoc(sourceRef, {
      status: 'PENDING_DELETION',
      deletionExecuteAt: executionDate,
    });
    return executionDate;
  }

  /**
   * Instantly undoes / cancels a scheduled deletion, restoring drive status to ACTIVE.
   */
  static async cancelSourceDeletion(vaultId: string, sourceId: string): Promise<void> {
    const sourceRef = doc(db, 'vaults', vaultId, 'sources', sourceId);
    await updateDoc(sourceRef, {
      status: 'ACTIVE',
      deletionExecuteAt: null,
    });
  }

  /**
   * Executes permanent deletion of a drive and all associated data:
   * 1. Physically purges the entire directory tree and version history in Backblaze B2 (`backups/{vaultId}/{sourceId}/`).
   * 2. Deletes all file metadata records in Firestore under `vaults/{vaultId}/files` for this sourceId (in 400-doc batches).
   * 3. Deletes any pending/active name reservations for this sourceId in `vaults/{vaultId}/nameReservations`.
   * 4. Deletes the source document `vaults/{vaultId}/sources/{sourceId}`.
   */
  static async executeSourceDeletion(
    vaultId: string,
    sourceId: string
  ): Promise<{ filesDeleted: number; b2PurgedCount: number }> {
    // 1. Physically delete all files and versions in Backblaze B2 under the drive's prefix
    let b2PurgedCount = 0;
    try {
      const b2Res = await B2AuthorizerClient.executeDeleteDrive(vaultId, sourceId);
      b2PurgedCount = b2Res.versionsPurged || 0;
    } catch (err) {
      console.warn(`B2 prefix purge encountered warning for source ${sourceId}:`, err);
    }

    // 2. Query and delete all file records in Firestore for this sourceId
    const filesQuery = query(
      collection(db, 'vaults', vaultId, 'files'),
      where('sourceId', '==', sourceId)
    );
    const filesSnap = await getDocs(filesQuery);
    let filesDeleted = 0;

    const fileDocs = filesSnap.docs;
    const sha256Set = new Set<string>();
    fileDocs.forEach((d) => {
      const data = typeof (d as any).data === 'function' ? (d as any).data() : (d as any);
      const sha = data?.sha256;
      if (sha) sha256Set.add(sha);
    });

    const CHUNK_SIZE = 400; // Under Firestore's 500 limit
    for (let i = 0; i < fileDocs.length; i += CHUNK_SIZE) {
      const chunk = fileDocs.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const d of chunk) {
        batch.delete(d.ref);
        filesDeleted++;
      }
      await batch.commit();
    }

    // Clean up contentHashes entries so re-backing up or re-uploading files from this drive syncs cleanly
    for (const sha of sha256Set) {
      try {
        await deleteDoc(doc(db, 'vaults', vaultId, 'contentHashes', sha));
      } catch {
        // Safe to ignore
      }
    }

    // 3. Clean up any nameReservations for this sourceId
    try {
      const resQuery = query(
        collection(db, 'vaults', vaultId, 'nameReservations'),
        where('sourceId', '==', sourceId)
      );
      const resSnap = await getDocs(resQuery);
      if (!resSnap.empty) {
        const batch = writeBatch(db);
        resSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.warn(`nameReservations cleanup warning for source ${sourceId}:`, err);
    }

    // 4. Delete the source document itself
    const sourceRef = doc(db, 'vaults', vaultId, 'sources', sourceId);
    await deleteDoc(sourceRef);

    return { filesDeleted, b2PurgedCount };
  }

  /**
   * Scans for any sources in PENDING_DELETION state whose 24-hour grace period has expired,
   * and automatically executes permanent deletion from both B2 and Firestore.
   */
  static async processExpiredDeletions(vaultId: string): Promise<string[]> {
    try {
      const sourcesQuery = query(
        collection(db, 'vaults', vaultId, 'sources'),
        where('status', '==', 'PENDING_DELETION')
      );
      const snap = await getDocs(sourcesQuery);
      const now = new Date();
      const expiredSourceIds: string[] = [];

      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const executeAt = data.deletionExecuteAt?.toDate ? data.deletionExecuteAt.toDate() : null;
        if (executeAt && executeAt <= now) {
          const sourceId = docSnap.id;
          console.info(`24-hour deletion window expired for drive ${sourceId}. Executing permanent B2 and Firestore purge...`);
          await this.executeSourceDeletion(vaultId, sourceId);
          expiredSourceIds.push(sourceId);
        }
      }

      return expiredSourceIds;
    } catch (err) {
      console.warn('Failed to process expired source deletions:', err);
      return [];
    }
  }

  /**
   * For Admins: calculates current on-demand authoritative server file count.
   */
  static async getSourceRealFileCount(vaultId: string, sourceId: string): Promise<number> {
    const q = query(
      collection(db, 'vaults', vaultId, 'files'),
      where('sourceId', '==', sourceId)
    );
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
  }

  /**
   * Anti-churn synchronization: updates sources/{sourceId}.totalFilesBackedUp ONLY
   * when the authoritative count differs from the cached count.
   */
  static async syncSourceFileCount(
    vaultId: string,
    sourceId: string,
    currentCachedCount: number
  ): Promise<number> {
    const realCount = await this.getSourceRealFileCount(vaultId, sourceId);
    if (realCount !== currentCachedCount) {
      try {
        await updateDoc(doc(db, 'vaults', vaultId, 'sources', sourceId), {
          totalFilesBackedUp: realCount,
        });
      } catch (err) {
        console.warn(`Failed to sync totalFilesBackedUp for source ${sourceId}:`, err);
      }
    }
    return realCount;
  }

  /**
   * Lists sources and, if caller is Admin, updates and synchronizes authoritative counts,
   * and automatically purges any drives whose 24-hour deletion window has elapsed.
   */
  static async listSourcesWithAuthoritativeCount(
    vaultId: string,
    isAdmin: boolean
  ): Promise<SourceEntity[]> {
    if (isAdmin) {
      try {
        await this.processExpiredDeletions(vaultId);
      } catch (err) {
        console.warn('Auto-purge of expired drives encountered an issue:', err);
      }
    }

    const sources = await this.listSources(vaultId);
    if (!isAdmin) {
      return sources;
    }

    const updatedSources = await Promise.all(
      sources.map(async (src) => {
        try {
          const realCount = await this.syncSourceFileCount(vaultId, src.sourceId, src.totalFilesBackedUp);
          return { ...src, totalFilesBackedUp: realCount };
        } catch {
          return src;
        }
      })
    );

    return updatedSources;
  }
}
