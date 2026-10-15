import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { AdminAuditRecord, AdminAuditAction } from '../../models/webCustomization';

export class AdminAuditService {
  /**
   * Logs an administrative action to vaults/{vaultId}/adminAudit.
   * Fire-and-forget: swallows errors with console.warn.
   */
  static async logAction(
    vaultId: string,
    params: {
      adminUid: string;
      adminEmail: string;
      action: AdminAuditAction;
      targetUid?: string;
      targetEmail?: string;
      details: string;
    }
  ): Promise<void> {
    if (!vaultId) return;

    try {
      const colRef = collection(db, 'vaults', vaultId, 'adminAudit');
      await addDoc(colRef, {
        adminUid: params.adminUid,
        adminEmail: params.adminEmail || '',
        action: params.action,
        targetUid: params.targetUid || null,
        targetEmail: params.targetEmail || null,
        details: params.details,
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.warn('AdminAuditService.logAction failed to record audit event:', err);
    }
  }

  /**
   * Retrieves recent admin audit logs, newest first.
   */
  static async listRecentAuditLogs(
    vaultId: string,
    limitCount = 50
  ): Promise<AdminAuditRecord[]> {
    if (!vaultId) return [];

    try {
      const colRef = collection(db, 'vaults', vaultId, 'adminAudit');
      const q = query(colRef, orderBy('timestamp', 'desc'), limit(limitCount));
      const snap = await getDocs(q);

      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          adminUid: d.adminUid || '',
          adminEmail: d.adminEmail || '',
          action: (d.action as AdminAuditAction) || 'UPDATE_GLOBAL_CONFIG',
          targetUid: d.targetUid || undefined,
          targetEmail: d.targetEmail || undefined,
          details: d.details || '',
          timestamp: (d.timestamp as Timestamp)?.toDate
            ? (d.timestamp as Timestamp).toDate()
            : new Date(),
        };
      });
    } catch (err) {
      console.warn('AdminAuditService.listRecentAuditLogs error:', err);
      return [];
    }
  }
}
