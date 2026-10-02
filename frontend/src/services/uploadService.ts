import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  setDoc,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { B2AuthorizerClient } from './b2Authorizer';
import { computeFileSha256 } from '../utils/crypto';
import { canonicalizePath, splitFilename } from '../utils/path';

export type UploadStage =
  | 'HASHING'
  | 'CHECKING_DEDUP'
  | 'ACQUIRING_LOCK'
  | 'RESERVING_VERSION'
  | 'UPLOADING'
  | 'FINALIZING';

export interface UploadCallbacks {
  onStage?: (stage: UploadStage) => void;
  onProgress?: (percent: number) => void;
}

export interface UploadResult {
  status: 'SUCCESS' | 'DUPLICATE_SKIPPED';
  fileId: string;
  storedName: string;
  version: number;
  sha256: string;
}

export class UploadService {
  /**
   * Ensures the virtual source "WEB_UPLOADS" exists in Firestore.
   */
  static async ensureWebUploadsSource(vaultId: string): Promise<void> {
    const sourceRef = doc(db, 'vaults', vaultId, 'sources', 'WEB_UPLOADS');
    const snap = await getDoc(sourceRef);
    if (!snap.exists()) {
      await setDoc(
        sourceRef,
        {
          sourceId: 'WEB_UPLOADS',
          displayName: 'Web Uploads',
          firstSeen: serverTimestamp(),
          lastSeen: serverTimestamp(),
          totalFilesBackedUp: 0,
        },
        { merge: true }
      );
    }
  }

  /**
   * Orchestrates the complete Web Direct Upload protocol:
   * 1. Chunked streaming SHA-256 calculation (<= 4 MiB chunks).
   * 2. Vault-wide Content Deduplication check.
   * 3. Epoch-fenced logical identity lock serialization.
   * 4. Heartbeat lease renewal (every 60s).
   * 5. Version resolution and atomic PENDING reservation.
   * 6. Direct browser-to-B2 presigned S3 PUT upload.
   * 7. Pre-commit fencing verification & atomic finalization.
   * 8. Compensating cleanup of UNCOMMITTED candidate objects on failure.
   */
  static async uploadFile(
    vaultId: string,
    targetRelativePath: string,
    file: File,
    callbacks?: UploadCallbacks
  ): Promise<UploadResult> {
    const user = auth.currentUser;
    if (!user) throw new Error('User must be authenticated to upload files.');

    const canonicalPath = canonicalizePath(targetRelativePath);
    await this.ensureWebUploadsSource(vaultId);

    // Stage 1: Chunked streaming SHA-256 computation
    callbacks?.onStage?.('HASHING');
    const sha256 = await computeFileSha256(file, (percent) => {
      callbacks?.onProgress?.(percent);
    });

    // Stage 2: Deduplication Check against active files in the folder & stale contentHashes cleanup
    callbacks?.onStage?.('CHECKING_DEDUP');

    // 1. Check if the exact same file is ALREADY active in this specific destination folder
    const existingFolderQuery = query(
      collection(db, 'vaults', vaultId, 'files'),
      where('sourceId', '==', 'WEB_UPLOADS'),
      where('relativePath', '==', canonicalPath),
      where('originalName', '==', file.name)
    );
    const existingFolderSnap = await getDocs(existingFolderQuery);
    const exactMatch = existingFolderSnap.docs.find(
      (d) => d.data().sha256 === sha256 && d.data().status === 'UPLOADED'
    );

    if (exactMatch) {
      return {
        status: 'DUPLICATE_SKIPPED',
        fileId: exactMatch.id,
        storedName: exactMatch.data().storedName || file.name,
        version: exactMatch.data().version ?? 0,
        sha256,
      };
    }

    // 2. Self-healing: if contentHashes entry exists but no active file in vault references it (e.g. file was deleted),
    // purge the stale hash record so it never creates ghost skips or orphaned references.
    const hashDocRef = doc(db, 'vaults', vaultId, 'contentHashes', sha256);
    const hashSnap = await getDoc(hashDocRef);
    if (hashSnap.exists()) {
      const activeFilesQuery = query(
        collection(db, 'vaults', vaultId, 'files'),
        where('sha256', '==', sha256),
        limit(1)
      );
      const activeFilesSnap = await getDocs(activeFilesQuery);
      if (activeFilesSnap.empty) {
        try {
          await deleteDoc(hashDocRef);
        } catch (err) {
          console.warn('Could not clean up stale contentHash record:', err);
        }
      }
    }

    // Stage 3: Acquire Epoch-Fenced Logical Identity Lock
    callbacks?.onStage?.('ACQUIRING_LOCK');
    const lockId = `LOCK_WEB_UPLOADS_${encodeURIComponent(canonicalPath)}_${encodeURIComponent(file.name)}`;
    const lockRef = doc(db, 'vaults', vaultId, 'nameReservations', lockId);
    const ownershipToken =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `token_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const LEASE_DURATION_MS = 60 * 1000; // 60-second lease
    const HEARTBEAT_INTERVAL_MS = 20 * 1000; // 20-second heartbeat renewal
    let lockEpoch = 1;

    await runTransaction(db, async (tx) => {
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists()) {
        const data = lockSnap.data();
        const expiresAt = data.expiresAt?.toMillis
          ? data.expiresAt.toMillis()
          : data.expiresAt?.toDate
            ? data.expiresAt.toDate().getTime()
            : 0;
        const now = Date.now();

        if (data.status === 'ACTIVE_LOCK' && expiresAt > now) {
          if (data.candidateSha256 === sha256) {
            throw new Error(
              `An upload of this exact file content is currently in progress. Please wait for it to complete.`
            );
          }
          throw new Error(
            `An upload for "${file.name}" in this directory is already in progress. Please wait for it to complete.`
          );
        }
        lockEpoch = Number(data.lockEpoch ?? data.epoch ?? 0) + 1;
      }

      tx.set(
        lockRef,
        {
          reservationId: lockId,
          sourceId: 'WEB_UPLOADS',
          relativePath: canonicalPath,
          originalName: file.name,
          status: 'ACTIVE_LOCK',
          ownerUid: user.uid,
          ownershipToken,
          candidateSha256: sha256,
          lockEpoch,
          epoch: lockEpoch,
          createdAt: serverTimestamp(),
          lastHeartbeatAt: serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + LEASE_DURATION_MS),
        },
        { merge: true }
      );
    });

    // Start lease renewal heartbeat every 20s (with 60s lease extension)
    let heartbeatActive = true;
    const heartbeatTimer = setInterval(async () => {
      if (!heartbeatActive) return;
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(lockRef);
          if (!snap.exists()) return;
          const data = snap.data();
          if (
            data.status !== 'ACTIVE_LOCK' ||
            data.ownershipToken !== ownershipToken ||
            (data.lockEpoch ?? data.epoch) !== lockEpoch
          ) {
            console.warn('Heartbeat: ownership token or epoch superseded.');
            heartbeatActive = false;
            return;
          }
          tx.update(lockRef, {
            expiresAt: Timestamp.fromMillis(Date.now() + LEASE_DURATION_MS),
            lastHeartbeatAt: serverTimestamp(),
          });
        });
      } catch (err) {
        console.warn('Heartbeat lease renewal failed:', err);
      }
    }, HEARTBEAT_INTERVAL_MS);

    let candidateObjectKey: string | null = null;
    let versionResId: string | null = null;

    try {
      // Stage 4: Version Resolution & Reservation
      callbacks?.onStage?.('RESERVING_VERSION');
      const existingFilesSnap = await getDocs(
        query(
          collection(db, 'vaults', vaultId, 'files'),
          where('sourceId', '==', 'WEB_UPLOADS'),
          where('relativePath', '==', canonicalPath),
          where('originalName', '==', file.name)
        )
      );

      const [base, ext] = splitFilename(file.name);
      let version = 0;
      let storedName = file.name;

      if (!existingFilesSnap.empty) {
        const versions = existingFilesSnap.docs.map((d) => d.data().version ?? 0);
        version = Math.max(...versions) + 1;
        storedName = `${base}(${version})${ext}`;
      }

      versionResId = `RES_WEB_UPLOADS_${encodeURIComponent(canonicalPath)}_${encodeURIComponent(storedName)}`;
      const versionResRef = doc(db, 'vaults', vaultId, 'nameReservations', versionResId);

      await setDoc(versionResRef, {
        reservationId: versionResId,
        sourceId: 'WEB_UPLOADS',
        relativePath: canonicalPath,
        originalName: file.name,
        storedName,
        version,
        sha256,
        status: 'PENDING',
        jobId: `web_${lockEpoch}`,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000), // 24 hour TTL
      });

      // Stage 5: Request Presigned Upload Authorization from Cloudflare Worker
      callbacks?.onStage?.('UPLOADING');
      candidateObjectKey = `backups/${vaultId}/WEB_UPLOADS/${canonicalPath}${storedName}`;
      const tempFileId = doc(collection(db, 'vaults', vaultId, 'files')).id;

      const authData = await B2AuthorizerClient.requestUploadAuthorization({
        objectKey: candidateObjectKey,
        sha256,
        sourceId: 'WEB_UPLOADS',
        originalName: file.name,
        fileId: tempFileId,
        fileSize: file.size,
      });

      // Stage 6: Direct Browser-to-B2 Presigned S3 PUT
      await B2AuthorizerClient.executePresignedPut(
        authData.uploadUrl,
        file,
        authData.headers,
        (transferred, total) => {
          if (total > 0) {
            callbacks?.onProgress?.(Math.min(100, Math.round((transferred / total) * 100)));
          }
        }
      );

      // Stage 7: Pre-Commit Fencing Verification & Atomic Finalization
      callbacks?.onStage?.('FINALIZING');
      const finalizedFileId = await runTransaction(db, async (tx) => {
        // 1. ALL READS FIRST (Strict Firestore transaction requirement)
        const lockSnap = await tx.get(lockRef);
        if (!lockSnap.exists()) {
          throw new Error('Upload aborted: logical lock document was removed.');
        }
        const lockData = lockSnap.data();
        if (
          lockData.status !== 'ACTIVE_LOCK' ||
          lockData.ownershipToken !== ownershipToken ||
          (lockData.lockEpoch ?? lockData.epoch) !== lockEpoch
        ) {
          throw new Error('Upload aborted: ownership lock lease was expired or acquired by another session.');
        }

        const canonicalHashRef = doc(db, 'vaults', vaultId, 'contentHashes', sha256);
        await tx.get(canonicalHashRef);

        // 2. ALL WRITES AFTER ALL READS
        // Create file document
        const newFileRef = doc(collection(db, 'vaults', vaultId, 'files'));
        tx.set(newFileRef, {
          fileId: newFileRef.id,
          sourceId: 'WEB_UPLOADS',
          relativePath: canonicalPath,
          originalName: file.name,
          storedName,
          sha256,
          size: file.size,
          lastModified: file.lastModified,
          mimeType: file.type || 'application/octet-stream',
          version,
          status: 'UPLOADED',
          uploadedAt: serverTimestamp(),
          jobId: `web_${lockEpoch}`,
          isPublicToFriends: false,
          allowedFriends: [],
          customPermissions: false,
          b2ObjectKey: candidateObjectKey,
        });

        // Register or update canonical content hash with current valid B2 object key
        tx.set(canonicalHashRef, {
          sha256,
          fileId: newFileRef.id,
          cloudObjectPath: candidateObjectKey,
          size: file.size,
          storedName,
          uploadedAt: serverTimestamp(),
        });

        // Mark version reservation COMMITTED
        if (versionResRef) {
          tx.update(versionResRef, { status: 'COMMITTED' });
        }

        // Release logical identity lock
        tx.update(lockRef, {
          status: 'RELEASED',
          releasedAt: serverTimestamp(),
        });

        return newFileRef.id;
      });

      return {
        status: 'SUCCESS',
        fileId: finalizedFileId,
        storedName,
        version,
        sha256,
      };
    } catch (err: any) {
      // Failure Compensation:
      // If candidate object was uploaded to B2, delete the UNCOMMITTED candidate object.
      // Invariant: NEVER delete canonical CAS objects.
      if (candidateObjectKey) {
        console.warn('Upload failed. Triggering compensating cleanup of uncommitted candidate object:', candidateObjectKey);
        await B2AuthorizerClient.executeDeleteCandidateObject(candidateObjectKey);
      }

      // Release logical identity lock on failure only if still owned by this session
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(lockRef);
          if (snap.exists()) {
            const data = snap.data();
            if (
              data.ownershipToken === ownershipToken &&
              (data.lockEpoch ?? data.epoch) === lockEpoch
            ) {
              tx.update(lockRef, {
                status: 'RELEASED',
                releasedAt: serverTimestamp(),
                lastError: err?.message || 'Upload failed',
              });
            }
          }
        });
      } catch (releaseErr) {
        console.warn('Failed to release logical lock:', releaseErr);
      }

      throw err;
    } finally {
      heartbeatActive = false;
      clearInterval(heartbeatTimer);
    }
  }
}
