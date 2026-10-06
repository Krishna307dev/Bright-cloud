import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  deleteDoc,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { BackupJob, ContentHashRecord, FileRecord } from '../../models';

export class JobService {
  /**
   * Lists recent backup ingest jobs in chronological order (startedAt DESC).
   * Accessible to Admin and Authorized Friends.
   */
  static async listRecentJobs(vaultId: string, limitCount = 50): Promise<BackupJob[]> {
    const jobsRef = collection(db, 'vaults', vaultId, 'backupJobs');
    const q = query(jobsRef, orderBy('startedAt', 'desc'), limit(limitCount));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(d => {
      const data = d.data();
      return {
        jobId: data.jobId || d.id,
        sourceId: data.sourceId || '',
        state: data.state || 'COMPLETED',
        startedAt: data.startedAt?.toDate ? data.startedAt.toDate() : new Date(),
        completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : undefined,
        totalFiles: data.totalFiles || 0,
        hashedFiles: data.hashedFiles || 0,
        skippedFiles: data.skippedFiles || 0,
        uploadedFiles: data.uploadedFiles || 0,
        errorFiles: data.errorFiles || 0,
        error: data.error || undefined,
      };
    });
  }

  /**
   * Real-time listener for recent backup jobs in chronological order (startedAt DESC).
   * Allows live visibility into in-flight upload jobs without polling.
   */
  static subscribeRecentJobs(
    vaultId: string,
    onUpdate: (jobs: BackupJob[]) => void,
    onError?: (err: Error) => void,
    limitCount = 50
  ): () => void {
    const jobsRef = collection(db, 'vaults', vaultId, 'backupJobs');
    const q = query(jobsRef, orderBy('startedAt', 'desc'), limit(limitCount));

    return onSnapshot(
      q,
      snapshot => {
        const jobs = snapshot.docs.map(d => {
          const data = d.data();
          return {
            jobId: data.jobId || d.id,
            sourceId: data.sourceId || '',
            state: data.state || 'COMPLETED',
            startedAt: data.startedAt?.toDate ? data.startedAt.toDate() : new Date(),
            completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : undefined,
            totalFiles: data.totalFiles || 0,
            hashedFiles: data.hashedFiles || 0,
            skippedFiles: data.skippedFiles || 0,
            uploadedFiles: data.uploadedFiles || 0,
            errorFiles: data.errorFiles || 0,
            error: data.error || undefined,
          };
        });
        onUpdate(jobs);
      },
      error => {
        if (onError) onError(error);
      }
    );
  }

  /**
   * Fetches all files recorded for a specific backup job.
   */
  static async getJobFiles(vaultId: string, jobId: string): Promise<FileRecord[]> {
    const filesRef = collection(db, 'vaults', vaultId, 'files');
    const q = query(filesRef, where('jobId', '==', jobId));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(d => {
      const data = d.data();
      return {
        fileId: d.id,
        sourceId: data.sourceId || '',
        relativePath: data.relativePath || '',
        originalName: data.originalName || '',
        storedName: data.storedName || data.originalName || '',
        sha256: data.sha256 || '',
        size: data.size || 0,
        lastModified: data.lastModified || 0,
        mimeType: data.mimeType,
        version: data.version || 0,
        status: data.status || 'UPLOADED',
        uploadedAt: data.uploadedAt?.toDate ? data.uploadedAt.toDate() : new Date(),
        jobId: data.jobId || jobId,
        isPublicToFriends: data.isPublicToFriends,
        allowedFriends: data.allowedFriends,
        customPermissions: data.customPermissions,
        b2ObjectKey: data.b2ObjectKey,
      };
    });
  }

  /**
   * Fetches all canonical content hash records in the vault.
   * Enables locating the exact identical copy of any deduplicated file.
   */
  static async getContentHashes(vaultId: string): Promise<ContentHashRecord[]> {
    const hashesRef = collection(db, 'vaults', vaultId, 'contentHashes');
    const snapshot = await getDocs(hashesRef);

    return snapshot.docs.map(d => {
      const data = d.data();
      return {
        sha256: d.id,
        storedName: data.storedName || 'Canonical Object',
        originalName: data.originalName || data.storedName || '',
        sourceId: data.sourceId || '',
        relativePath: data.relativePath || '',
        size: data.size || 0,
        uploadedAt: data.uploadedAt?.toDate ? data.uploadedAt.toDate() : new Date(),
        fileId: data.fileId || '',
        b2ObjectKey: data.b2ObjectKey || '',
      };
    });
  }

  /**
   * Deletes a stale or unfinalized backup job record (Admin only under firestore.rules line 135).
   */
  static async dismissJob(vaultId: string, jobId: string): Promise<void> {
    const jobRef = doc(db, 'vaults', vaultId, 'backupJobs', jobId);
    await deleteDoc(jobRef);
  }
}
