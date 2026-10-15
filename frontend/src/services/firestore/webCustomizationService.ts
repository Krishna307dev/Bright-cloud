import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_WEB_CONFIG,
  type WebCustomizationConfig,
  type UserCustomSettings,
} from '../../models/webCustomization';
import { AdminAuditService } from './adminAuditService';

export class WebCustomizationService {
  /**
   * Retrieves global web customization config from vaults/{vaultId}/settings/webConfig.
   */
  static async getWebConfig(vaultId: string): Promise<WebCustomizationConfig> {
    if (!vaultId) return DEFAULT_WEB_CONFIG;

    try {
      const docRef = doc(db, 'vaults', vaultId, 'settings', 'webConfig');
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return DEFAULT_WEB_CONFIG;
      }
      const data = snap.data();
      return {
        ...DEFAULT_WEB_CONFIG,
        ...data,
        visibleTabs: {
          ...DEFAULT_WEB_CONFIG.visibleTabs,
          ...(data.visibleTabs || {}),
        },
        banner: {
          ...DEFAULT_WEB_CONFIG.banner,
          ...(data.banner || {}),
        },
        uploadRules: {
          ...DEFAULT_WEB_CONFIG.uploadRules,
          ...(data.uploadRules || {}),
        },
        downloadRules: {
          ...DEFAULT_WEB_CONFIG.downloadRules,
          ...(data.downloadRules || {}),
        },
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : undefined,
      };
    } catch (err) {
      console.warn('WebCustomizationService.getWebConfig failed:', err);
      return DEFAULT_WEB_CONFIG;
    }
  }

  /**
   * Subscribes to real-time changes of global web customization config.
   */
  static subscribeWebConfig(
    vaultId: string,
    onUpdate: (config: WebCustomizationConfig) => void
  ): () => void {
    if (!vaultId) {
      onUpdate(DEFAULT_WEB_CONFIG);
      return () => {};
    }

    const docRef = doc(db, 'vaults', vaultId, 'settings', 'webConfig');
    return onSnapshot(
      docRef,
      (snap) => {
        if (!snap.exists()) {
          onUpdate(DEFAULT_WEB_CONFIG);
          return;
        }
        const data = snap.data();
        onUpdate({
          ...DEFAULT_WEB_CONFIG,
          ...data,
          visibleTabs: {
            ...DEFAULT_WEB_CONFIG.visibleTabs,
            ...(data.visibleTabs || {}),
          },
          banner: {
            ...DEFAULT_WEB_CONFIG.banner,
            ...(data.banner || {}),
          },
          uploadRules: {
            ...DEFAULT_WEB_CONFIG.uploadRules,
            ...(data.uploadRules || {}),
          },
          downloadRules: {
            ...DEFAULT_WEB_CONFIG.downloadRules,
            ...(data.downloadRules || {}),
          },
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : undefined,
        });
      },
      (err) => {
        console.warn('WebCustomizationService.subscribeWebConfig error:', err);
        onUpdate(DEFAULT_WEB_CONFIG);
      }
    );
  }

  /**
   * Updates global web customization config in vaults/{vaultId}/settings/webConfig.
   */
  static async updateWebConfig(
    vaultId: string,
    updates: Partial<WebCustomizationConfig>,
    adminInfo?: { uid: string; email: string }
  ): Promise<void> {
    const docRef = doc(db, 'vaults', vaultId, 'settings', 'webConfig');
    const payload = {
      ...updates,
      updatedAt: serverTimestamp(),
      updatedBy: adminInfo?.email || 'admin',
    };

    await setDoc(docRef, payload, { merge: true });

    if (adminInfo) {
      const summaryKeys = Object.keys(updates).join(', ');
      await AdminAuditService.logAction(vaultId, {
        adminUid: adminInfo.uid,
        adminEmail: adminInfo.email,
        action: 'UPDATE_GLOBAL_CONFIG',
        details: `Updated global website settings: ${summaryKeys}`,
      });
    }
  }

  /**
   * Resets global web customization config to defaults.
   */
  static async resetWebConfig(
    vaultId: string,
    adminInfo?: { uid: string; email: string }
  ): Promise<void> {
    const docRef = doc(db, 'vaults', vaultId, 'settings', 'webConfig');
    const payload = {
      ...DEFAULT_WEB_CONFIG,
      updatedAt: serverTimestamp(),
      updatedBy: adminInfo?.email || 'admin',
    };

    await setDoc(docRef, payload);

    if (adminInfo) {
      await AdminAuditService.logAction(vaultId, {
        adminUid: adminInfo.uid,
        adminEmail: adminInfo.email,
        action: 'RESET_GLOBAL_CONFIG',
        details: 'Reset global website customization to default settings',
      });
    }
  }

  /**
   * Updates per-user customization overrides stored on vaults/{vaultId}/users/{uid}.
   */
  static async updateUserOverrides(
    vaultId: string,
    targetUid: string,
    overrides: Partial<UserCustomSettings>,
    adminInfo?: { uid: string; email: string },
    targetEmail?: string
  ): Promise<void> {
    const userRef = doc(db, 'vaults', vaultId, 'users', targetUid);

    await setDoc(
      userRef,
      {
        customSettings: {
          ...overrides,
          updatedAt: serverTimestamp(),
        },
      },
      { merge: true }
    );

    if (adminInfo) {
      const summaryKeys = Object.keys(overrides).join(', ');
      await AdminAuditService.logAction(vaultId, {
        adminUid: adminInfo.uid,
        adminEmail: adminInfo.email,
        action: 'UPDATE_USER_OVERRIDE',
        targetUid,
        targetEmail,
        details: `Updated user overrides for ${targetEmail || targetUid}: ${summaryKeys}`,
      });
    }
  }

  /**
   * Resets per-user customization overrides back to inherited global settings.
   */
  static async resetUserOverrides(
    vaultId: string,
    targetUid: string,
    adminInfo?: { uid: string; email: string },
    targetEmail?: string
  ): Promise<void> {
    const userRef = doc(db, 'vaults', vaultId, 'users', targetUid);

    await updateDoc(userRef, {
      customSettings: deleteField(),
    });

    if (adminInfo) {
      await AdminAuditService.logAction(vaultId, {
        adminUid: adminInfo.uid,
        adminEmail: adminInfo.email,
        action: 'RESET_USER_OVERRIDE',
        targetUid,
        targetEmail,
        details: `Reset customization overrides for user ${targetEmail || targetUid} to global defaults`,
      });
    }
  }

  /**
   * Sets user suspension status.
   */
  static async setUserSuspended(
    vaultId: string,
    targetUid: string,
    suspended: boolean,
    adminInfo?: { uid: string; email: string },
    targetEmail?: string
  ): Promise<void> {
    const userRef = doc(db, 'vaults', vaultId, 'users', targetUid);

    await setDoc(
      userRef,
      {
        customSettings: {
          suspended,
          updatedAt: serverTimestamp(),
        },
      },
      { merge: true }
    );

    if (adminInfo) {
      await AdminAuditService.logAction(vaultId, {
        adminUid: adminInfo.uid,
        adminEmail: adminInfo.email,
        action: suspended ? 'SUSPEND_USER' : 'ACTIVATE_USER',
        targetUid,
        targetEmail,
        details: suspended
          ? `Suspended user ${targetEmail || targetUid}`
          : `Activated/unsuspended user ${targetEmail || targetUid}`,
      });
    }
  }
}
