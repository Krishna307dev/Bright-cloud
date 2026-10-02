import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { B2AuthorizerClient } from './b2Authorizer';

export interface ReconciliationSummary {
  expiredLocksReconciled: number;
  expiredVersionReservationsReconciled: number;
  uncommittedCandidatesDeleted: number;
}

export class ReconciliationService {
  /**
   * Session-driven Admin reconciliation for nameReservations:
   * Correctly distinguishes:
   * 1. Logical identity lock documents:
   *    status = 'ACTIVE_LOCK' | 'RELEASED'
   *    Expired when status === 'ACTIVE_LOCK' && expiresAt < now
   * 2. Version reservation documents:
   *    status = 'PENDING' | 'COMMITTED'
   *    Expired when status === 'PENDING' && expiresAt < now
   *
   * Invariant: ONLY performs compensating B2 DELETE if the referenced object is an
   * UNCOMMITTED candidate and NO active file or immutable contentHashes/{sha256} record depends on it.
   * NEVER issues /b2/delete-authorize for a finalized canonical CAS object.
   */
  static async reconcileStaleReservations(vaultId: string): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = {
      expiredLocksReconciled: 0,
      expiredVersionReservationsReconciled: 0,
      uncommittedCandidatesDeleted: 0,
    };

    const reservationsRef = collection(db, 'vaults', vaultId, 'nameReservations');
    const snapshot = await getDocs(reservationsRef);
    const now = new Date();

    for (const resDoc of snapshot.docs) {
      const data = resDoc.data();
      const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : null;
      if (!expiresAt || expiresAt >= now) {
        continue;
      }

      // Case 1: Logical identity lock document
      const isLockDoc =
        resDoc.id.startsWith('LOCK_') ||
        data.status === 'ACTIVE_LOCK' ||
        data.status === 'RELEASED';

      if (isLockDoc) {
        if (data.status === 'ACTIVE_LOCK') {
          // Lock is expired!
          const candidateSha = data.candidateSha256;

          // Check if candidateSha has become canonical
          let isCanonical = false;
          if (candidateSha) {
            const canonicalSnap = await getDoc(
              doc(db, 'vaults', vaultId, 'contentHashes', candidateSha)
            );
            isCanonical = canonicalSnap.exists();
          }

          // If not canonical, verify no active file document depends on it
          if (!isCanonical && candidateSha) {
            const fileQuery = query(
              collection(db, 'vaults', vaultId, 'files'),
              where('sha256', '==', candidateSha)
            );
            const fileSnap = await getDocs(fileQuery);
            if (fileSnap.empty) {
              // Confirmed UNCOMMITTED candidate object!
              const candidateKey = `backups/${vaultId}/${data.sourceId || 'WEB_UPLOADS'}/${data.relativePath || ''}${data.originalName || ''}`;
              await B2AuthorizerClient.executeDeleteCandidateObject(candidateKey);
              summary.uncommittedCandidatesDeleted++;
            }
          }

          // Release the expired lock
          await updateDoc(resDoc.ref, {
            status: 'RELEASED',
            releasedAt: serverTimestamp(),
            reconciledAt: serverTimestamp(),
            reconcileNote: 'Expired lock released by session-driven Admin reconciliation',
          });
          summary.expiredLocksReconciled++;
        }
        continue;
      }

      // Case 2: Version reservation document
      if (data.status === 'PENDING') {
        const sha256 = data.sha256;

        // Check if sha256 is canonical
        let isCanonical = false;
        if (sha256) {
          const canonicalSnap = await getDoc(
            doc(db, 'vaults', vaultId, 'contentHashes', sha256)
          );
          isCanonical = canonicalSnap.exists();
        }

        // If not canonical, check active files
        if (!isCanonical && sha256) {
          const fileQuery = query(
            collection(db, 'vaults', vaultId, 'files'),
            where('sha256', '==', sha256)
          );
          const fileSnap = await getDocs(fileQuery);
          if (fileSnap.empty) {
            // Confirmed UNCOMMITTED candidate object!
            const candidateKey =
              data.cloudObjectPath ||
              `backups/${vaultId}/${data.sourceId || 'WEB_UPLOADS'}/${data.relativePath || ''}${data.storedName || ''}`;
            await B2AuthorizerClient.executeDeleteCandidateObject(candidateKey);
            summary.uncommittedCandidatesDeleted++;
          }
        }

        // Delete stale version reservation document to free the name
        await deleteDoc(resDoc.ref);
        summary.expiredVersionReservationsReconciled++;
      }
    }

    return summary;
  }
}
