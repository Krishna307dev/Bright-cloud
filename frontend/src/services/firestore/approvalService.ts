import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { ApprovalRequest, ApprovalStatus } from '../../models';

export interface SubmitApprovalParams {
  uid: string;
  email: string;
  name: string;
  reason: string;
  referredBy: string;
}

export class ApprovalService {
  /**
   * Submits or updates an approval request in approvalRequests/{uid}.
   * One request per user; resubmission updates the same document.
   */
  static async submitApprovalRequest(params: SubmitApprovalParams): Promise<ApprovalRequest> {
    const cleanName = params.name.trim();
    const cleanReason = params.reason.trim();
    const cleanReferredBy = params.referredBy.trim().slice(0, 100);

    if (!cleanName) {
      throw new Error('Name is required.');
    }
    if (!cleanReason) {
      throw new Error('Reason is required.');
    }
    if (!cleanReferredBy) {
      throw new Error('Please enter how you found this website or who referred you.');
    }

    const docRef = doc(db, 'approvalRequests', params.uid);
    const existingSnap = await getDoc(docRef);

    const now = new Date();
    const isUpdate = existingSnap.exists();
    const existingData = isUpdate ? existingSnap.data() : null;

    const dataToSave = {
      uid: params.uid,
      email: params.email || existingData?.email || '',
      name: cleanName,
      reason: cleanReason,
      referredBy: cleanReferredBy,
      status: 'pending' as ApprovalStatus,
      createdAt: isUpdate && existingData?.createdAt ? existingData.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(docRef, dataToSave, { merge: true });

    return {
      uid: params.uid,
      email: params.email,
      name: cleanName,
      reason: cleanReason,
      referredBy: cleanReferredBy,
      status: 'pending',
      createdAt: isUpdate && existingData?.createdAt ? (existingData.createdAt as Timestamp)?.toDate?.() || now : now,
      updatedAt: now,
    };
  }

  /**
   * Retrieves an approval request for a given user UID if it exists.
   */
  static async getApprovalRequest(uid: string): Promise<ApprovalRequest | null> {
    try {
      const docRef = doc(db, 'approvalRequests', uid);
      const snap = await getDoc(docRef);
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        uid: snap.id,
        email: data.email || '',
        name: data.name || '',
        reason: data.reason || '',
        referredBy: data.referredBy || '',
        status: (data.status as ApprovalStatus) || 'pending',
        createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate() : new Date(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate ? (data.updatedAt as Timestamp).toDate() : undefined,
      };
    } catch (err) {
      console.warn('Could not fetch approval request:', err);
      return null;
    }
  }

  /**
   * Lists all approval requests (Admin only).
   */
  static async listApprovalRequests(): Promise<Map<string, ApprovalRequest>> {
    const map = new Map<string, ApprovalRequest>();
    try {
      const snap = await getDocs(collection(db, 'approvalRequests'));
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        map.set(docSnap.id, {
          uid: docSnap.id,
          email: data.email || '',
          name: data.name || '',
          reason: data.reason || '',
          referredBy: data.referredBy || '',
          status: (data.status as ApprovalStatus) || 'pending',
          createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate() : new Date(),
          updatedAt: (data.updatedAt as Timestamp)?.toDate ? (data.updatedAt as Timestamp).toDate() : undefined,
        });
      }
    } catch (err) {
      console.warn('Could not query approvalRequests collection:', err);
    }
    return map;
  }

  /**
   * Updates an approval request status (e.g. 'approved' or 'rejected') (Admin only).
   */
  static async updateApprovalStatus(uid: string, status: ApprovalStatus): Promise<void> {
    const docRef = doc(db, 'approvalRequests', uid);
    await updateDoc(docRef, {
      status,
      updatedAt: serverTimestamp(),
    });
  }
}
