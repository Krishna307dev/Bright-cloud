import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  limit,
  updateDoc,
  setDoc,
  runTransaction,
  deleteDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, auth } from '../firebase';
import type { VaultConfig, UserProfile, UserRole } from '../../models';
import { B2AuthorizerClient } from '../b2Authorizer';
import { ApprovalService } from './approvalService';
import { classifyFirebaseError, type AuthStateCategory } from '../../utils/error';

export class VaultService {
  /**
   * Executes the 2-step role probe strictly distinguishing permission-denied from network errors.
   */
  static async resolveUserRole(vaultId: string, _user: User): Promise<AuthStateCategory> {
    const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');

    // Step 1: Admin Probe
    try {
      const snap = await getDoc(configRef);
      if (snap.exists()) {
        return 'AUTHENTICATED_ADMIN';
      } else {
        return 'VAULT_UNINITIALIZED';
      }
    } catch (err: any) {
      const classification = classifyFirebaseError(err);
      if (classification === 'NETWORK_ERROR') {
        return 'NETWORK_ERROR';
      }
      if (classification !== 'PERMISSION_DENIED') {
        // Unexpected non-permission error
        return 'NETWORK_ERROR';
      }
      // If permission-denied, proceed to Step 2
    }

    // Step 2: Friend Probe
    try {
      const sourcesQuery = query(collection(db, 'vaults', vaultId, 'sources'), limit(1));
      await getDocs(sourcesQuery);
      return 'AUTHENTICATED_FRIEND';
    } catch (err: any) {
      const classification = classifyFirebaseError(err);
      if (classification === 'NETWORK_ERROR') {
        return 'NETWORK_ERROR';
      }
      if (classification === 'PERMISSION_DENIED') {
        return 'UNAUTHORIZED';
      }
      return 'NETWORK_ERROR';
    }
  }

  /**
   * Fetches vault settings (Admin only).
   */
  static async getVaultConfig(vaultId: string): Promise<VaultConfig | null> {
    const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');
    const snap = await getDoc(configRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      vaultId,
      adminUids: data.adminUids || [],
      authorizedFriends: data.authorizedFriends || [],
      friendDirectory: data.friendDirectory || {},
      userDirectory: data.userDirectory || {},
      vaultName: data.vaultName || 'Bright Cloud Vault',
    };
  }

  /**
   * Updates vault settings (Admin only).
   */
  static async updateVaultConfig(vaultId: string, updates: Partial<VaultConfig>): Promise<void> {
    const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');
    await updateDoc(configRef, updates);
  }

  /**
   * Adds or updates an authorized friend with Admin-entered descriptive metadata note (Admin only).
   */
  static async addAuthorizedFriend(
    vaultId: string,
    friendUid: string,
    label?: string,
    email?: string
  ): Promise<void> {
    const cleanUid = friendUid.trim();
    if (!cleanUid) throw new Error('UID cannot be empty.');

    const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(configRef);
      if (!snap.exists()) throw new Error('Vault config does not exist.');

      const data = snap.data();
      const currentFriends: string[] = data.authorizedFriends || [];
      const currentDirectory = { ...(data.friendDirectory || {}) };

      const newFriends = Array.from(new Set([...currentFriends, cleanUid]));
      const newDirectory = { ...currentDirectory };
      newDirectory[cleanUid] = {
        label: label?.trim() || currentDirectory[cleanUid]?.label || '',
        email: email?.trim() || currentDirectory[cleanUid]?.email || '',
        addedAt: currentDirectory[cleanUid]?.addedAt || new Date().toISOString(),
      };

      tx.update(configRef, {
        authorizedFriends: newFriends,
        friendDirectory: newDirectory,
      });
    });
  }

  /**
   * Atomically modifies collaborator role (ADMIN, FRIEND, or REVOKED) with last-admin guard.
   */
  static async changeCollaboratorRole(
    vaultId: string,
    targetUid: string,
    newRole: 'ADMIN' | 'FRIEND' | 'REVOKED'
  ): Promise<void> {
    const cleanUid = targetUid.trim();
    if (!cleanUid) throw new Error('UID cannot be empty.');

    const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(configRef);
      if (!snap.exists()) throw new Error('Vault config does not exist.');

      const data = snap.data();
      let adminUids: string[] = [...(data.adminUids || [])];
      let authorizedFriends: string[] = [...(data.authorizedFriends || [])];
      const friendDirectory = { ...(data.friendDirectory || {}) };

      const isCurrentAdmin = adminUids.includes(cleanUid);

      if (isCurrentAdmin && newRole !== 'ADMIN' && adminUids.length <= 1) {
        throw new Error('Cannot demote or remove the last Administrator of the vault.');
      }

      // Remove from all existing roles first
      adminUids = adminUids.filter((uid) => uid !== cleanUid);
      authorizedFriends = authorizedFriends.filter((uid) => uid !== cleanUid);

      if (newRole === 'ADMIN') {
        adminUids.push(cleanUid);
      } else if (newRole === 'FRIEND') {
        authorizedFriends.push(cleanUid);
      } else if (newRole === 'REVOKED') {
        delete friendDirectory[cleanUid];
      }

      tx.update(configRef, {
        adminUids,
        authorizedFriends,
        friendDirectory,
      });
    });
  }

  /**
   * Removes an authorized friend and cleans up directory metadata (Admin only).
   */
  static async removeAuthorizedFriend(vaultId: string, friendUid: string): Promise<void> {
    await this.changeCollaboratorRole(vaultId, friendUid, 'REVOKED');
  }

  /**
   * Initializes a new vault config document if uninitialized (Admin only).
   */
  static async bootstrapVaultConfig(
    vaultId: string,
    adminUid: string,
    vaultName = 'Bright Cloud Vault'
  ): Promise<void> {
    const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');
    await setDoc(configRef, {
      adminUids: [adminUid],
      authorizedFriends: [],
      friendDirectory: {},
      vaultName,
    });
  }

  /**
   * Fetches user profile for a specific UID in the vault.
   */
  static async getUserProfile(vaultId: string, uid: string): Promise<UserProfile | null> {
    try {
      const userRef = doc(db, 'vaults', vaultId, 'users', uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        uid,
        email: data.email || '',
        displayName: data.displayName || data.email?.split('@')[0] || 'User',
        photoURL: data.photoURL || undefined,
        lastLogin: data.lastLogin?.toDate ? data.lastLogin.toDate() : new Date(data.lastLogin || Date.now()),
        role: (data.role as UserRole) || 'pending',
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Automatically records / updates Google Sign-In user profile in vaults/{vaultId}/users/{uid}
   * and mirrors into vaults/{vaultId}/settings/config for resilient access.
   */
  static async syncUserProfile(
    vaultId: string,
    user: { uid: string; email?: string | null; displayName?: string | null; photoURL?: string | null },
    forcedRole?: UserRole
  ): Promise<void> {
    const cleanEmail = user.email || '';
    const cleanName = user.displayName || cleanEmail.split('@')[0] || 'User';

    // 1. Try to record in vaults/{vaultId}/users/{uid} (for standard Firestore schema)
    try {
      const userRef = doc(db, 'vaults', vaultId, 'users', user.uid);
      const snap = await getDoc(userRef);
      const existing = snap.exists() ? snap.data() : null;

      let role: UserRole = forcedRole || (existing?.role as UserRole) || 'pending';

      if (!forcedRole) {
        try {
          const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');
          const configSnap = await getDoc(configRef);
          if (configSnap.exists()) {
            const cfg = configSnap.data();
            if (cfg.adminUids?.includes(user.uid)) {
              role = 'admin';
            } else if (cfg.authorizedFriends?.includes(user.uid)) {
              role = 'friend';
            } else if (existing?.role) {
              role = existing.role as UserRole;
            } else {
              role = 'pending';
            }
          }
        } catch {
          // Non-admin may get permission-denied reading config; fallback to existing
          if (existing?.role) {
            role = existing.role as UserRole;
          }
        }
      }

      await setDoc(
        userRef,
        {
          uid: user.uid,
          email: cleanEmail || existing?.email || '',
          displayName: cleanName || existing?.displayName || 'Google User',
          photoURL: user.photoURL || existing?.photoURL || '',
          lastLogin: new Date(),
          role,
          createdAt: existing?.createdAt?.toDate ? existing.createdAt.toDate() : (existing?.createdAt || new Date()),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Could not sync user profile in vaults/{vaultId}/users:', err);
    }

    // 2. Also record in settings/config if admin or authorized (so it is 100% resilient)
    try {
      const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');
      const configSnap = await getDoc(configRef);
      if (configSnap.exists()) {
        const cfg = configSnap.data();
        const isAdmin = cfg.adminUids?.includes(user.uid);
        if (isAdmin) {
          const userDirectory = { ...(cfg.userDirectory || {}) };
          const friendDirectory = { ...(cfg.friendDirectory || {}) };

          userDirectory[user.uid] = {
            uid: user.uid,
            email: cleanEmail,
            displayName: cleanName,
            photoURL: user.photoURL || '',
            role: 'admin',
            lastLogin: new Date().toISOString(),
          };

          if (!friendDirectory[user.uid]) {
            friendDirectory[user.uid] = {
              label: cleanName,
              email: cleanEmail,
              addedAt: new Date().toISOString(),
            };
          } else {
            friendDirectory[user.uid].label = cleanName;
            friendDirectory[user.uid].email = cleanEmail;
          }

          await updateDoc(configRef, {
            userDirectory,
            friendDirectory,
          });
        }
      }
    } catch {
      // Non-admins cannot write settings/config; safe to ignore
    }
  }

  /**
   * Lists all Google sign-in users registered in the vault (Admin only).
   * Resiliently merges users from vaults/{vaultId}/users and vaults/{vaultId}/settings/config.
   */
  static async listUsers(vaultId: string): Promise<UserProfile[]> {
    const userMap = new Map<string, UserProfile>();

    // 1. Fetch vault settings/config first (always accessible to Admins under existing deployed rules)
    const cfg = await this.getVaultConfig(vaultId);

    // 2. Resiliently attempt to query vaults/{vaultId}/users subcollection
    try {
      const usersCol = collection(db, 'vaults', vaultId, 'users');
      const snap = await getDocs(usersCol);
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const uid = docSnap.id;

        // Authoritative role sync with settings/config
        let role: UserRole = (data.role as UserRole) || 'pending';
        if (cfg?.adminUids?.includes(uid)) {
          role = 'admin';
        } else if (cfg?.authorizedFriends?.includes(uid)) {
          role = 'friend';
        }

        userMap.set(uid, {
          uid,
          email: data.email || '',
          displayName: data.displayName || data.email?.split('@')[0] || 'User',
          photoURL: data.photoURL || undefined,
          lastLogin: data.lastLogin?.toDate ? data.lastLogin.toDate() : new Date(data.lastLogin || Date.now()),
          role,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : undefined,
        });
      }
    } catch (err: any) {
      console.warn(
        'Could not query vaults/{vaultId}/users subcollection. Operating in settings/config fallback mode. (Update firestore.rules in Firebase Console to enable automatic user subcollection indexing):',
        err?.message || err
      );
    }

    // 3. Merge users from settings/config.userDirectory if present
    if (cfg?.userDirectory) {
      for (const [uid, u] of Object.entries(cfg.userDirectory)) {
        if (!userMap.has(uid)) {
          let role: UserRole = (u.role as UserRole) || 'pending';
          if (cfg?.adminUids?.includes(uid)) role = 'admin';
          else if (cfg?.authorizedFriends?.includes(uid)) role = 'friend';

          userMap.set(uid, {
            uid,
            email: u.email || '',
            displayName: u.displayName || u.email?.split('@')[0] || 'User',
            photoURL: u.photoURL || undefined,
            lastLogin: u.lastLogin ? new Date(u.lastLogin) : new Date(),
            role,
            createdAt: u.createdAt ? new Date(u.createdAt) : undefined,
          });
        }
      }
    }

    // Current active authenticated user from auth
    const currentAuthUser = auth.currentUser;

    // 4. Also include any users in friendDirectory or adminUids not yet having a doc
    if (cfg?.adminUids) {
      for (const adminUid of cfg.adminUids) {
        const isCurrent = currentAuthUser?.uid === adminUid;
        if (!userMap.has(adminUid)) {
          userMap.set(adminUid, {
            uid: adminUid,
            email: isCurrent ? (currentAuthUser?.email || 'krishna23902@gmail.com') : (cfg.friendDirectory?.[adminUid]?.email || 'admin@vault.local'),
            displayName: isCurrent ? (currentAuthUser?.displayName || 'Krishna Sharma') : (cfg.friendDirectory?.[adminUid]?.label || 'Vault Administrator'),
            photoURL: isCurrent ? (currentAuthUser?.photoURL || undefined) : undefined,
            lastLogin: new Date(),
            role: 'admin',
          });
        } else if (isCurrent) {
          const profile = userMap.get(adminUid)!;
          if (currentAuthUser?.email && (!profile.email || profile.email === 'admin@vault.local')) {
            profile.email = currentAuthUser.email;
          }
          if (currentAuthUser?.displayName && (!profile.displayName || profile.displayName === 'Vault Administrator')) {
            profile.displayName = currentAuthUser.displayName;
          }
          if (currentAuthUser?.photoURL && !profile.photoURL) {
            profile.photoURL = currentAuthUser.photoURL;
          }
        }
      }
    }

    if (cfg?.authorizedFriends) {
      for (const friendUid of cfg.authorizedFriends) {
        if (!userMap.has(friendUid)) {
          userMap.set(friendUid, {
            uid: friendUid,
            email: cfg.friendDirectory?.[friendUid]?.email || 'friend@vault.local',
            displayName: cfg.friendDirectory?.[friendUid]?.label || 'Authorized Friend',
            lastLogin: new Date(),
            role: 'friend',
          });
        }
      }
    }

    // 5. Merge pending users from authorizer backend
    try {
      const pendingUsers = await B2AuthorizerClient.listPendingUsers();
      for (const p of pendingUsers) {
        if (!userMap.has(p.uid)) {
          let role: UserRole = 'pending';
          if (cfg?.adminUids?.includes(p.uid)) role = 'admin';
          else if (cfg?.authorizedFriends?.includes(p.uid)) role = 'friend';

          userMap.set(p.uid, {
            uid: p.uid,
            email: p.email || '',
            displayName: p.displayName || p.email?.split('@')[0] || 'User',
            photoURL: p.photoURL || undefined,
            lastLogin: new Date(p.registeredAt || Date.now()),
            role,
          });
        }
      }
    } catch {
      // Safe to ignore if authorizer is unreachable
    }

    // 6. Merge users from approvalRequests collection (ensures all unapproved users appear)
    try {
      const approvalMap = await ApprovalService.listApprovalRequests();
      for (const [reqUid, req] of approvalMap.entries()) {
        if (!userMap.has(reqUid)) {
          let role: UserRole = 'pending';
          if (cfg?.adminUids?.includes(reqUid)) role = 'admin';
          else if (cfg?.authorizedFriends?.includes(reqUid)) role = 'friend';
          else if (req.status === 'approved') role = 'friend';
          else if (req.status === 'rejected') role = 'ignored';

          userMap.set(reqUid, {
            uid: reqUid,
            email: req.email || '',
            displayName: req.name || req.email?.split('@')[0] || 'User',
            photoURL: undefined,
            lastLogin: req.updatedAt || req.createdAt || new Date(),
            role,
            createdAt: req.createdAt,
          });
        }
      }
    } catch {
      // Safe to ignore if approvalRequests query fails
    }

    return Array.from(userMap.values()).sort((a, b) => {
      const order: Record<UserRole, number> = { admin: 0, friend: 1, pending: 2, ignored: 3 };
      if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
      return a.displayName.localeCompare(b.displayName);
    });
  }

  /**
   * Updates user role in both settings/config and users/{uid} collection.
   */
  static async setUserRole(vaultId: string, uid: string, newRole: UserRole): Promise<void> {
    if (newRole === 'admin') {
      await this.changeCollaboratorRole(vaultId, uid, 'ADMIN');
    } else if (newRole === 'friend') {
      await this.changeCollaboratorRole(vaultId, uid, 'FRIEND');
    } else {
      await this.changeCollaboratorRole(vaultId, uid, 'REVOKED');
    }

    // Also update settings/config.userDirectory
    try {
      const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');
      const snap = await getDoc(configRef);
      if (snap.exists()) {
        const data = snap.data();
        const userDirectory = { ...(data.userDirectory || {}) };
        if (userDirectory[uid]) {
          userDirectory[uid].role = newRole;
        } else {
          userDirectory[uid] = {
            uid,
            role: newRole,
            email: data.friendDirectory?.[uid]?.email || '',
            displayName: data.friendDirectory?.[uid]?.label || 'User',
            lastLogin: new Date().toISOString(),
          };
        }
        await updateDoc(configRef, { userDirectory });
      }
    } catch (err) {
      console.warn('Could not update userDirectory in settings/config:', err);
    }

    // Also update vaults/{vaultId}/users/{uid} document if permitted
    const userRef = doc(db, 'vaults', vaultId, 'users', uid);
    try {
      await updateDoc(userRef, { role: newRole });
    } catch {
      try {
        await setDoc(userRef, { uid, role: newRole, lastLogin: new Date() }, { merge: true });
      } catch (err) {
        console.warn('Could not update vaults/{vaultId}/users/{uid} document (check Firestore rules):', err);
      }
    }
  }

  /**
   * Deletes user record from vault and revokes all access.
   */
  static async deleteUser(vaultId: string, uid: string): Promise<void> {
    try {
      await this.changeCollaboratorRole(vaultId, uid, 'REVOKED');
    } catch (err) {
      console.warn('Could not revoke role during user deletion:', err);
    }

    // Clean from userDirectory in settings/config
    try {
      const configRef = doc(db, 'vaults', vaultId, 'settings', 'config');
      const snap = await getDoc(configRef);
      if (snap.exists()) {
        const data = snap.data();
        const userDirectory = { ...(data.userDirectory || {}) };
        if (userDirectory[uid]) {
          delete userDirectory[uid];
          await updateDoc(configRef, { userDirectory });
        }
      }
    } catch (err) {
      console.warn('Could not clean userDirectory in settings/config:', err);
    }

    const userRef = doc(db, 'vaults', vaultId, 'users', uid);
    try {
      await deleteDoc(userRef);
    } catch (err) {
      console.warn('Could not delete user document from users collection:', err);
    }
  }
}

