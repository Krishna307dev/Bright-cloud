import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  updateDoc,
  deleteDoc,
  increment,
  documentId,
  writeBatch,
  setDoc,
  type DocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { B2AuthorizerClient } from '../b2Authorizer';
import type { FileRecord } from '../../models';
import { canonicalizePath, splitFilename } from '../../utils/path';

export interface DualStreamPaginationState {
  lastPublicDoc: DocumentSnapshot | null;
  lastFriendDoc: DocumentSnapshot | null;
  publicHasMore: boolean;
  friendHasMore: boolean;
  fileMap: Map<string, FileRecord>;
}

export interface FolderItem {
  name: string;
  relativePath: string;
  fileCount: number;
  totalBytes: number;
}

export function isSystemFileOrFolder(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed.startsWith('.')) return true;
  if (lower === 'lost.dir' || lower === 'thumbs.db' || lower === 'desktop.ini') return true;
  return false;
}

export function extractSubdirectories(files: FileRecord[], currentPath: string, showHidden = false): FolderItem[] {
  const canonicalCurrent = canonicalizePath(currentPath);
  const folderMap = new Map<string, FolderItem>();

  for (const file of files) {
    const isKeep = file.originalName === '.keep' || file.storedName === '.keep';
    if (!showHidden && !isKeep && (isSystemFileOrFolder(file.originalName) || isSystemFileOrFolder(file.storedName))) {
      continue;
    }
    const canonicalRel = canonicalizePath(file.relativePath);
    if (canonicalRel === canonicalCurrent) continue;

    if (canonicalCurrent === '' || canonicalRel.startsWith(canonicalCurrent)) {
      const remainder = canonicalCurrent === '' ? canonicalRel : canonicalRel.slice(canonicalCurrent.length);
      const segs = remainder.split('/').filter(Boolean);
      if (segs.length > 0) {
        const subName = segs[0];
        if (!showHidden && !isKeep && isSystemFileOrFolder(subName)) {
          continue;
        }
        const subPath = canonicalCurrent + subName + '/';
        const existing = folderMap.get(subPath) || {
          name: subName,
          relativePath: subPath,
          fileCount: 0,
          totalBytes: 0,
        };
        if (file.originalName !== '.keep') {
          existing.fileCount += 1;
          existing.totalBytes += (file.size || 0);
        }
        folderMap.set(subPath, existing);
      }
    }
  }

  return Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function mapToFileRecord(docSnap: DocumentSnapshot): FileRecord {
  const data = docSnap.data() || {};
  return {
    fileId: docSnap.id,
    sourceId: data.sourceId || '',
    relativePath: canonicalizePath(data.relativePath || ''),
    originalName: data.originalName || '',
    storedName: data.storedName || data.originalName || '',
    sha256: data.sha256 || '',
    size: data.size || 0,
    lastModified: data.lastModified || 0,
    mimeType: data.mimeType || undefined,
    version: data.version ?? 0,
    status: 'UPLOADED',
    uploadedAt: data.uploadedAt?.toDate ? data.uploadedAt.toDate() : new Date(),
    jobId: data.jobId || '',
    isPublicToFriends: data.isPublicToFriends ?? false,
    allowedFriends: data.allowedFriends || [],
    customPermissions: data.customPermissions ?? false,
    b2ObjectKey: data.b2ObjectKey || undefined,
  };
}

function isIndexError(err: any): boolean {
  const msg = err?.message || '';
  const code = err?.code || '';
  return code === 'failed-precondition' || msg.includes('requires an index') || msg.includes('The query requires an index');
}

export class FileService {
  /**
   * Retrieves all files belonging to a specific source without requiring any composite index.
   * Enables comprehensive subfolder hierarchy discovery and true total file counts.
   * For non-admin (Authorized Friends), transparently queries public files and friend-shared files
   * to strictly satisfy deployed Cloud Firestore security rules.
   */
  static async listAllSourceFiles(
    vaultId: string,
    sourceId: string,
    userUid?: string,
    isAdmin?: boolean
  ): Promise<FileRecord[]> {
    if (isAdmin) {
      const q = query(
        collection(db, 'vaults', vaultId, 'files'),
        where('sourceId', '==', sourceId)
      );
      const snap = await getDocs(q);
      return snap.docs.map(mapToFileRecord);
    }

    try {
      // First attempt standard query in case user has full access
      const q = query(
        collection(db, 'vaults', vaultId, 'files'),
        where('sourceId', '==', sourceId)
      );
      const snap = await getDocs(q);
      return snap.docs.map(mapToFileRecord);
    } catch (err: any) {
      const msg = err?.message || '';
      const code = err?.code || '';
      if (code === 'permission-denied' || msg.includes('Missing or insufficient permissions') || msg.includes('permission')) {
        // Fallback for Authorized Friends: Query public files and specifically allowed files
        const queries = [
          getDocs(query(
            collection(db, 'vaults', vaultId, 'files'),
            where('sourceId', '==', sourceId),
            where('isPublicToFriends', '==', true)
          ))
        ];

        if (userUid) {
          queries.push(getDocs(query(
            collection(db, 'vaults', vaultId, 'files'),
            where('sourceId', '==', sourceId),
            where('allowedFriends', 'array-contains', userUid)
          )));
        }

        const snapshots = await Promise.all(queries);
        const fileMap = new Map<string, FileRecord>();
        for (const snap of snapshots) {
          for (const docSnap of snap.docs) {
            fileMap.set(docSnap.id, mapToFileRecord(docSnap));
          }
        }
        return Array.from(fileMap.values());
      }
      throw err;
    }
  }

  /**
   * Fetches a single file document by ID.
   */
  static async getFile(vaultId: string, fileId: string): Promise<FileRecord | null> {
    const fileRef = doc(db, 'vaults', vaultId, 'files', fileId);
    const snap = await getDoc(fileRef);
    if (!snap.exists()) return null;
    return mapToFileRecord(snap);
  }

  /**
   * Admin folder query: lists all files in a specific folder with deterministic ordering.
   * If composite index is missing, seamlessly falls back to equality query + client-side deterministic
   * sorting across the complete folder result set, guaranteeing zero skipped files.
   * Performance tradeoff: fallback reads all documents in that specific folder.
   */
  static async listAdminFolderFiles(
    vaultId: string,
    sourceId: string,
    relativePath: string,
    lastDoc: DocumentSnapshot | null = null,
    pageSize = 50
  ): Promise<{ files: FileRecord[]; lastDoc: DocumentSnapshot | null; hasMore: boolean; isFallback?: boolean }> {
    const canonical = canonicalizePath(relativePath);

    try {
      let q = query(
        collection(db, 'vaults', vaultId, 'files'),
        where('sourceId', '==', sourceId),
        where('relativePath', '==', canonical),
        orderBy('originalName', 'asc'),
        orderBy(documentId(), 'asc'),
        limit(pageSize)
      );

      if (lastDoc) {
        q = query(q, startAfter(lastDoc));
      }

      const snap = await getDocs(q);
      const files = snap.docs.map(mapToFileRecord);
      const newLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;

      return {
        files,
        lastDoc: newLastDoc,
        hasMore: snap.docs.length === pageSize,
        isFallback: false,
      };
    } catch (err: any) {
      if (isIndexError(err)) {
        console.warn('Composite index missing for Admin folder query. Executing correctness-preserving full-set fallback.');
        
        // Correctness fallback: Equality query without orderBy/limit
        const qFallback = query(
          collection(db, 'vaults', vaultId, 'files'),
          where('sourceId', '==', sourceId),
          where('relativePath', '==', canonical)
        );

        const snap = await getDocs(qFallback);
        const allFiles = snap.docs.map(mapToFileRecord);

        // Deterministic sort: originalName ASC, fileId ASC
        allFiles.sort((a, b) => {
          const nameCmp = a.originalName.localeCompare(b.originalName);
          if (nameCmp !== 0) return nameCmp;
          return a.fileId.localeCompare(b.fileId);
        });

        // Client-side windowing
        const startIndex = lastDoc
          ? Math.max(0, allFiles.findIndex(f => f.fileId === lastDoc.id) + 1)
          : 0;
        const pageFiles = allFiles.slice(startIndex, startIndex + pageSize);
        const lastPageItem = pageFiles.length > 0 ? pageFiles[pageFiles.length - 1] : null;
        const newLastDoc = lastPageItem
          ? snap.docs.find(d => d.id === lastPageItem.fileId) || null
          : null;

        return {
          files: pageFiles,
          lastDoc: newLastDoc,
          hasMore: startIndex + pageSize < allFiles.length,
          isFallback: true,
        };
      }
      throw err;
    }
  }

  /**
   * Dual-query cursor pagination for Friends browsing a specific folder.
   * Merges Query A (Public) and Query B (Shared with user) with independent cursors.
   * If composite index is missing, executes separate authorized equality fallback queries
   * and merges the complete result sets deterministically.
   */
  static async fetchFriendFolderFiles(
    vaultId: string,
    sourceId: string,
    relativePath: string,
    userUid: string,
    state: DualStreamPaginationState,
    pageSize = 50
  ): Promise<FileRecord[]> {
    const canonical = canonicalizePath(relativePath);

    try {
      const promises: Promise<QuerySnapshot>[] = [];

      // Query A: Public stream
      if (state.publicHasMore) {
        let qA = query(
          collection(db, 'vaults', vaultId, 'files'),
          where('sourceId', '==', sourceId),
          where('relativePath', '==', canonical),
          where('isPublicToFriends', '==', true),
          orderBy('originalName', 'asc'),
          orderBy(documentId(), 'asc'),
          limit(pageSize)
        );
        if (state.lastPublicDoc) qA = query(qA, startAfter(state.lastPublicDoc));
        promises.push(getDocs(qA));
      }

      // Query B: Friend-shared stream
      if (state.friendHasMore) {
        let qB = query(
          collection(db, 'vaults', vaultId, 'files'),
          where('sourceId', '==', sourceId),
          where('relativePath', '==', canonical),
          where('allowedFriends', 'array-contains', userUid),
          orderBy('originalName', 'asc'),
          orderBy(documentId(), 'asc'),
          limit(pageSize)
        );
        if (state.lastFriendDoc) qB = query(qB, startAfter(state.lastFriendDoc));
        promises.push(getDocs(qB));
      }

      const results = await Promise.all(promises);
      let idx = 0;

      if (state.publicHasMore) {
        const snapA = results[idx++];
        state.publicHasMore = snapA.docs.length === pageSize;
        if (snapA.docs.length > 0) state.lastPublicDoc = snapA.docs[snapA.docs.length - 1];
        snapA.docs.forEach(d => state.fileMap.set(d.id, mapToFileRecord(d)));
      }

      if (state.friendHasMore) {
        const snapB = results[idx++];
        state.friendHasMore = snapB.docs.length === pageSize;
        if (snapB.docs.length > 0) state.lastFriendDoc = snapB.docs[snapB.docs.length - 1];
        snapB.docs.forEach(d => state.fileMap.set(d.id, mapToFileRecord(d)));
      }

      // Deterministic deduplicated sort matching Firestore tie-breaker
      return Array.from(state.fileMap.values()).sort((a, b) => {
        const nameCmp = a.originalName.localeCompare(b.originalName);
        if (nameCmp !== 0) return nameCmp;
        return a.fileId.localeCompare(b.fileId);
      });
    } catch (err: any) {
      if (isIndexError(err)) {
        console.warn('Composite index missing for Friend folder query. Executing separate authorized equality fallback queries.');
        
        // Correctness fallback for Friend: Separate queries without orderBy/limit
        const qFriendPublic = query(
          collection(db, 'vaults', vaultId, 'files'),
          where('sourceId', '==', sourceId),
          where('relativePath', '==', canonical),
          where('isPublicToFriends', '==', true)
        );

        const qFriendShared = query(
          collection(db, 'vaults', vaultId, 'files'),
          where('sourceId', '==', sourceId),
          where('relativePath', '==', canonical),
          where('allowedFriends', 'array-contains', userUid)
        );

        const [snapA, snapB] = await Promise.all([getDocs(qFriendPublic), getDocs(qFriendShared)]);

        snapA.docs.forEach(d => state.fileMap.set(d.id, mapToFileRecord(d)));
        snapB.docs.forEach(d => state.fileMap.set(d.id, mapToFileRecord(d)));
        state.publicHasMore = false;
        state.friendHasMore = false;

        return Array.from(state.fileMap.values()).sort((a, b) => {
          const nameCmp = a.originalName.localeCompare(b.originalName);
          if (nameCmp !== 0) return nameCmp;
          return a.fileId.localeCompare(b.fileId);
        });
      }
      throw err;
    }
  }

  /**
   * Fetches unified stream of all files shared with or public to the user (used on /shared and Dashboard).
   */
  static async fetchSharedFiles(
    vaultId: string,
    userUid: string,
    pageSize = 100
  ): Promise<FileRecord[]> {
    const fileMap = new Map<string, FileRecord>();

    // Stream 1: Public files
    const qPublic = query(
      collection(db, 'vaults', vaultId, 'files'),
      where('isPublicToFriends', '==', true),
      orderBy('uploadedAt', 'desc'),
      limit(pageSize)
    );

    // Stream 2: Files specifically shared with this user
    const qShared = query(
      collection(db, 'vaults', vaultId, 'files'),
      where('allowedFriends', 'array-contains', userUid),
      orderBy('uploadedAt', 'desc'),
      limit(pageSize)
    );

    try {
      const [snapPublic, snapShared] = await Promise.all([getDocs(qPublic), getDocs(qShared)]);
      snapPublic.docs.forEach(d => fileMap.set(d.id, mapToFileRecord(d)));
      snapShared.docs.forEach(d => fileMap.set(d.id, mapToFileRecord(d)));
    } catch (err: any) {
      if (isIndexError(err)) {
        console.warn('Composite index missing for Shared stream. Executing fallback.');
        const qPubFallback = query(
          collection(db, 'vaults', vaultId, 'files'),
          where('isPublicToFriends', '==', true)
        );
        const qSharedFallback = query(
          collection(db, 'vaults', vaultId, 'files'),
          where('allowedFriends', 'array-contains', userUid)
        );
        const [snapPublic, snapShared] = await Promise.all([getDocs(qPubFallback), getDocs(qSharedFallback)]);
        snapPublic.docs.forEach(d => fileMap.set(d.id, mapToFileRecord(d)));
        snapShared.docs.forEach(d => fileMap.set(d.id, mapToFileRecord(d)));
      } else {
        throw err;
      }
    }

    return Array.from(fileMap.values()).sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }

  static async fetchFriendRecentFiles(
    vaultId: string,
    userUid: string,
    pageSize = 100
  ): Promise<FileRecord[]> {
    return this.fetchSharedFiles(vaultId, userUid, pageSize);
  }

  /**
   * Admin recent files: lists all recent files across the vault ordered by uploadedAt DESC.
   */
  static async listAdminRecentFiles(vaultId: string, limitCount = 50): Promise<FileRecord[]> {
    const q = query(
      collection(db, 'vaults', vaultId, 'files'),
      orderBy('uploadedAt', 'desc'),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(mapToFileRecord);
  }

  /**
   * Finds all versions of a file (sharing sourceId, relativePath, originalName).
   */
  static async getFileVersions(
    vaultId: string,
    sourceId: string,
    relativePath: string,
    originalName: string
  ): Promise<FileRecord[]> {
    const canonical = canonicalizePath(relativePath);
    const q = query(
      collection(db, 'vaults', vaultId, 'files'),
      where('sourceId', '==', sourceId),
      where('relativePath', '==', canonical),
      where('originalName', '==', originalName),
      orderBy(documentId(), 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(mapToFileRecord).sort((a, b) => b.version - a.version);
  }

  /**
   * Sets explicit file-level custom permissions, marking customPermissions = true.
   * Admin only.
   */
  static async updateFilePermissions(
    vaultId: string,
    fileId: string,
    isPublicToFriends: boolean,
    allowedFriends: string[]
  ): Promise<void> {
    const fileRef = doc(db, 'vaults', vaultId, 'files', fileId);
    await updateDoc(fileRef, {
      isPublicToFriends,
      allowedFriends,
      customPermissions: true, // Invariant: protects file from automatic folder reconciliation
    });
  }

  /**
   * Physically deletes the file from Backblaze B2 storage and removes metadata from Firestore.
   * Decrements source counter and cleans up contentHashes deduplication metadata and name reservations.
   */
  static async removeFileFromVault(
    vaultId: string,
    fileId: string,
    sourceId?: string,
    b2ObjectKey?: string
  ): Promise<void> {
    const fileRef = doc(db, 'vaults', vaultId, 'files', fileId);

    let targetKey = b2ObjectKey;
    let actualSourceId = sourceId;
    let fileSha256: string | null = null;
    let fileRelativePath: string | null = null;
    let fileStoredName: string | null = null;

    try {
      const snap = await getDoc(fileRef);
      if (snap?.exists?.()) {
        const d = snap.data();
        actualSourceId = actualSourceId || d.sourceId;
        targetKey = targetKey || d.b2ObjectKey || (d.sourceId ? `backups/${vaultId}/${d.sourceId}/${d.relativePath || ''}${d.storedName || d.originalName}` : null);
        fileSha256 = d.sha256 || null;
        fileRelativePath = d.relativePath || '';
        fileStoredName = d.storedName || d.originalName || null;
      }
    } catch (err) {
      console.warn('Could not read file doc before deletion:', err);
    }

    // 1. Physically delete S3 object from Backblaze B2
    if (targetKey) {
      try {
        await B2AuthorizerClient.executeDeleteObject(targetKey);
      } catch (err) {
        console.warn(`Could not physically delete B2 object '${targetKey}':`, err);
      }
    }

    // 2. Delete active file metadata document
    await deleteDoc(fileRef);

    // 3. Decrement source counter if physical source exists
    if (actualSourceId && actualSourceId !== 'WEB_UPLOADS') {
      try {
        const sourceRef = doc(db, 'vaults', vaultId, 'sources', actualSourceId);
        await updateDoc(sourceRef, {
          totalFilesBackedUp: increment(-1),
        });
      } catch (err) {
        console.warn(`Could not decrement counter for source ${actualSourceId}:`, err);
      }
    }

    // 4. Clean up contentHashes deduplication entry
    // Once the physical B2 object is deleted, contentHashes MUST be cleaned up so re-uploading
    // this file does not result in dead CAS pointers, 404s, or ghost deduplication skips.
    if (fileSha256) {
      try {
        const hashRef = doc(db, 'vaults', vaultId, 'contentHashes', fileSha256);
        await deleteDoc(hashRef);
      } catch (err) {
        console.warn(`Could not clean up contentHashes for ${fileSha256}:`, err);
      }
    }

    // 5. Clean up nameReservation document to free up filename and prevent stale reservations
    try {
      const canonical = canonicalizePath(fileRelativePath || '');
      const resId = `RES_${actualSourceId || 'WEB_UPLOADS'}_${encodeURIComponent(canonical)}_${encodeURIComponent(fileStoredName || '')}`;
      if (resId && !resId.endsWith('_')) {
        await deleteDoc(doc(db, 'vaults', vaultId, 'nameReservations', resId)).catch(() => {});
      }
    } catch {
      // Safe to ignore
    }
  }

  /**
   * Batch deletes multiple files from both Backblaze B2 storage and Firestore.
   * Cleans up contentHashes deduplication metadata and name reservations for all deleted files.
   */
  static async deleteFiles(
    vaultId: string,
    files: FileRecord[]
  ): Promise<void> {
    if (files.length === 0) return;

    const sourceCountMap = new Map<string, number>();
    const sha256Set = new Set<string>();
    let batch = writeBatch(db);
    let opCount = 0;

    for (const f of files) {
      if (f.sha256 && f.originalName !== '.keep') {
        sha256Set.add(f.sha256);
      }

      const b2Key = f.b2ObjectKey || `backups/${vaultId}/${f.sourceId}/${f.relativePath}${f.storedName}`;
      // 1. Physically delete B2 object
      try {
        await B2AuthorizerClient.executeDeleteObject(b2Key);
      } catch (err) {
        console.warn(`Could not physically delete B2 object '${b2Key}':`, err);
      }

      // 2. Delete Firestore metadata (1 delete per file)
      const ref = doc(db, 'vaults', vaultId, 'files', f.fileId);
      batch.delete(ref);
      opCount++;

      if (opCount >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }

      // 3. Track count per source
      if (f.sourceId && f.sourceId !== 'WEB_UPLOADS') {
        const curr = sourceCountMap.get(f.sourceId) || 0;
        sourceCountMap.set(f.sourceId, curr + 1);
      }
    }

    // Update source counters
    for (const [sId, count] of sourceCountMap.entries()) {
      try {
        const sourceRef = doc(db, 'vaults', vaultId, 'sources', sId);
        batch.update(sourceRef, {
          totalFilesBackedUp: increment(-count),
        });
        opCount++;
        if (opCount >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        }
      } catch (err) {
        console.warn(`Could not update source counter for ${sId}:`, err);
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }

    // 4. Clean up contentHashes entries for all deleted files so re-uploads sync cleanly
    for (const sha of sha256Set) {
      try {
        const hashRef = doc(db, 'vaults', vaultId, 'contentHashes', sha);
        await deleteDoc(hashRef);
      } catch (err) {
        console.warn(`Could not clean up contentHashes for ${sha}:`, err);
      }
    }

    // 5. Clean up name reservations and locks for deleted files
    for (const f of files) {
      const storedName = f.storedName || f.originalName;
      if (storedName && f.originalName !== '.keep') {
        try {
          const canonical = canonicalizePath(f.relativePath || '');
          const resIds = [
            `RES_${f.sourceId || 'WEB_UPLOADS'}_${encodeURIComponent(canonical)}_${encodeURIComponent(storedName)}`,
            `RES_WEB_UPLOADS_${encodeURIComponent(canonical)}_${encodeURIComponent(storedName)}`,
            `LOCK_${f.sourceId || 'WEB_UPLOADS'}_${encodeURIComponent(canonical)}_${encodeURIComponent(storedName)}`,
            `LOCK_WEB_UPLOADS_${encodeURIComponent(canonical)}_${encodeURIComponent(storedName)}`,
          ];
          for (const resId of resIds) {
            await deleteDoc(doc(db, 'vaults', vaultId, 'nameReservations', resId)).catch(() => {});
          }
        } catch {
          // Safe to ignore
        }
      }
    }
  }

  /**
   * Batch moves files to a new destination folder.
   * Physically moves the object in Backblaze B2 via S3 CopyObject + DeleteObject,
   * then updates relativePath and b2ObjectKey in Firestore.
   */
  static async moveFiles(
    vaultId: string,
    fileIds: string[],
    targetRelativePath: string
  ): Promise<void> {
    const canonical = canonicalizePath(targetRelativePath);
    let batch = writeBatch(db);
    let opCount = 0;

    for (const id of fileIds) {
      const ref = doc(db, 'vaults', vaultId, 'files', id);
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const d = snap.data();
          const sourceId = d.sourceId || 'WEB_UPLOADS';
          const storedName = d.storedName || d.originalName || '';
          const oldRelative = canonicalizePath(d.relativePath || '');
          const oldB2Key = d.b2ObjectKey || `backups/${vaultId}/${sourceId}/${oldRelative}${storedName}`;
          const newB2Key = `backups/${vaultId}/${sourceId}/${canonical}${storedName}`;

          if (oldB2Key !== newB2Key) {
            await B2AuthorizerClient.moveObject(oldB2Key, newB2Key);
          }

          batch.update(ref, {
            relativePath: canonical,
            b2ObjectKey: newB2Key,
          });

          // Keep contentHashes synchronized with new cloudObjectPath
          if (d.sha256) {
            const hashRef = doc(db, 'vaults', vaultId, 'contentHashes', d.sha256);
            batch.set(hashRef, { cloudObjectPath: newB2Key }, { merge: true });
          }

          // Clean up old name reservation
          try {
            const oldResId = `RES_${sourceId}_${encodeURIComponent(oldRelative)}_${encodeURIComponent(storedName)}`;
            await deleteDoc(doc(db, 'vaults', vaultId, 'nameReservations', oldResId)).catch(() => {});
          } catch {}
        } else {
          batch.update(ref, { relativePath: canonical });
        }
      } catch (err) {
        console.warn(`Error moving file ${id} in B2:`, err);
        batch.update(ref, { relativePath: canonical });
      }

      opCount++;
      if (opCount >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  }

  /**
   * Batch copies files to a new destination folder.
   * Physically duplicates the object in Backblaze B2 via S3 CopyObject so the storage structure matches,
   * and creates new FileRecord entries pointing to the identical SHA-256 CAS content hash.
   */
  static async copyFiles(
    vaultId: string,
    filesToCopy: FileRecord[],
    targetRelativePath: string,
    targetSourceId: string
  ): Promise<void> {
    const canonical = canonicalizePath(targetRelativePath);
    let batch = writeBatch(db);
    let opCount = 0;

    // Fetch existing files in target destination to resolve filename collisions
    const existingNames = new Set<string>();
    try {
      const q = query(
        collection(db, 'vaults', vaultId, 'files'),
        where('sourceId', '==', targetSourceId),
        where('relativePath', '==', canonical)
      );
      const existingSnap = await getDocs(q);
      existingSnap.docs.forEach((d) => {
        const data = d.data();
        const n = data.storedName || data.originalName;
        if (n) existingNames.add(n.toLowerCase());
      });
    } catch (err) {
      console.warn('Could not check existing filenames in destination:', err);
    }

    let copiedCount = 0;

    for (const file of filesToCopy) {
      const oldRelative = canonicalizePath(file.relativePath || '');
      const rawStoredName = file.storedName || file.originalName || '';
      const rawOriginalName = file.originalName || rawStoredName;
      const sourceKey = file.b2ObjectKey || `backups/${vaultId}/${file.sourceId}/${oldRelative}${rawStoredName}`;

      let destStoredName = rawStoredName;
      let destOriginalName = rawOriginalName;
      let version = file.version || 0;

      // If copying into the same folder or destination already has a file with this name, resolve a unique name
      if (existingNames.has(destStoredName.toLowerCase())) {
        const [base, ext] = splitFilename(rawOriginalName);
        let counter = 1;
        while (existingNames.has(`${base}(${counter})${ext}`.toLowerCase())) {
          counter++;
        }
        destStoredName = `${base}(${counter})${ext}`;
        destOriginalName = `${base}(${counter})${ext}`;
        version = counter;
      }
      existingNames.add(destStoredName.toLowerCase());

      const destKey = `backups/${vaultId}/${targetSourceId}/${canonical}${destStoredName}`;

      // 1. Physically copy object in Backblaze B2 so storage matches folder structure
      try {
        await B2AuthorizerClient.copyObject(sourceKey, destKey);
      } catch (err) {
        console.warn(`Error copying file ${file.fileId} in B2:`, err);
      }

      // 2. Create new FileRecord in Firestore
      const newDocRef = doc(collection(db, 'vaults', vaultId, 'files'));
      batch.set(newDocRef, {
        sourceId: targetSourceId,
        relativePath: canonical,
        originalName: destOriginalName,
        storedName: destStoredName,
        b2ObjectKey: destKey,
        sha256: file.sha256,
        size: file.size,
        lastModified: file.lastModified,
        mimeType: file.mimeType || null,
        version,
        status: 'UPLOADED',
        uploadedAt: new Date(),
        jobId: 'WEB_COPY',
        isPublicToFriends: file.isPublicToFriends,
        allowedFriends: file.allowedFriends || [],
        customPermissions: file.customPermissions || false,
      });

      copiedCount++;
      opCount++;
      if (opCount >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }
    }

    // 3. Increment source file counter if physical source
    if (targetSourceId && targetSourceId !== 'WEB_UPLOADS' && copiedCount > 0) {
      try {
        const sourceRef = doc(db, 'vaults', vaultId, 'sources', targetSourceId);
        batch.update(sourceRef, {
          totalFilesBackedUp: increment(copiedCount),
        });
        opCount++;
      } catch (err) {
        console.warn(`Could not increment counter for source ${targetSourceId}:`, err);
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  }

  /**
   * Creates a new folder by establishing a persistent .keep placeholder document.
   * Allows empty folder navigation and hierarchy indexing across all Firestore queries.
   */
  static async createFolder(
    vaultId: string,
    sourceId: string,
    parentPath: string,
    folderName: string
  ): Promise<string> {
    const canonicalParent = canonicalizePath(parentPath);
    const folderPath = canonicalParent + folderName.trim().replace(/^\/+|\/+$/g, '') + '/';

    const newDocRef = doc(collection(db, 'vaults', vaultId, 'files'));
    await setDoc(newDocRef, {
      sourceId,
      relativePath: folderPath,
      originalName: '.keep',
      storedName: '.keep',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      size: 0,
      lastModified: Date.now(),
      version: 0,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      jobId: 'CREATE_FOLDER',
      isPublicToFriends: false,
      allowedFriends: [],
      customPermissions: false,
    });

    return folderPath;
  }

  /**
   * Deletes an entire folder and all its contents recursively.
   * Physically deletes files from Backblaze B2, removes Firestore documents,
   * cleans up any folder rules, and updates source file count.
   */
  static async deleteFolder(
    vaultId: string,
    sourceId: string,
    folderPath: string
  ): Promise<number> {
    const canonical = canonicalizePath(folderPath);
    const allFiles = await this.listAllSourceFiles(vaultId, sourceId);
    const folderFiles = allFiles.filter((f) => {
      const rel = canonicalizePath(f.relativePath);
      return rel === canonical || rel.startsWith(canonical);
    });

    if (folderFiles.length === 0) {
      return 0;
    }

    await this.deleteFiles(vaultId, folderFiles);

    try {
      const folderKey = canonical.replace(/\/+$/, '').replace(/\//g, '_');
      const ruleRef = doc(db, 'vaults', vaultId, 'folderRules', folderKey);
      await deleteDoc(ruleRef);
    } catch {
      // rule might not exist
    }

    return folderFiles.filter((f) => f.originalName !== '.keep').length;
  }

  /**
   * Performs a complete clean-slate storage wipe:
   * 1. Physically purges all files and versions in Backblaze B2 under backups/{vaultId}/ (preserving _system/).
   * 2. Deletes all Firestore documents in:
   *    - vaults/{vaultId}/files
   *    - vaults/{vaultId}/sources
   *    - vaults/{vaultId}/nameReservations
   *    - vaults/{vaultId}/backupJobs
   *    - vaults/{vaultId}/folderRules
   *    - vaults/{vaultId}/contentHashes
   * 3. STRICTLY PRESERVES:
   *    - vaults/{vaultId}/settings/config (vault settings, admin UIDs, friend UIDs)
   *    - vaults/{vaultId}/users/* (all user accounts and Google login profiles)
   */
  static async wipeAllStorage(vaultId: string): Promise<{
    b2PurgedCount: number;
    filesDeleted: number;
    sourcesDeleted: number;
    reservationsDeleted: number;
    jobsDeleted: number;
    rulesDeleted: number;
  }> {
    // 1. Purge B2 storage
    let b2PurgedCount = 0;
    try {
      const b2Res = await B2AuthorizerClient.executeWipeVault(vaultId);
      b2PurgedCount = b2Res.versionsPurged || 0;
    } catch (err) {
      console.warn('B2 vault wipe warning:', err);
    }

    // Helper to delete all documents in a subcollection
    const deleteSubcollection = async (subcollName: string): Promise<number> => {
      let count = 0;
      try {
        const snap = await getDocs(collection(db, 'vaults', vaultId, subcollName));
        const docs = snap.docs;
        const CHUNK_SIZE = 400;
        for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
          const chunk = docs.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          for (const d of chunk) {
            batch.delete(d.ref);
            count++;
          }
          await batch.commit();
        }
      } catch (err) {
        console.warn(`Warning deleting ${subcollName}:`, err);
      }
      return count;
    };

    const filesDeleted = await deleteSubcollection('files');
    const sourcesDeleted = await deleteSubcollection('sources');
    const reservationsDeleted = await deleteSubcollection('nameReservations');
    const jobsDeleted = await deleteSubcollection('backupJobs');
    const rulesDeleted = await deleteSubcollection('folderRules');
    await deleteSubcollection('contentHashes');

    return {
      b2PurgedCount,
      filesDeleted,
      sourcesDeleted,
      reservationsDeleted,
      jobsDeleted,
      rulesDeleted,
    };
  }
}

