import { collection, getDocs, query, orderBy, limit, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { BackupJob } from '../../models';

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
   * Deletes a stale or unfinalized backup job record (Admin only under firestore.rules line 135).
   */
  static async dismissJob(vaultId: string, jobId: string): Promise<void> {
    const jobRef = doc(db, 'vaults', vaultId, 'backupJobs', jobId);
    await deleteDoc(jobRef);
  }
}
