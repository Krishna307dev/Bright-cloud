/**
 * Vault configuration model representing vaults/{vaultId}/settings/config.
 * Only readable and writable by Admins under firestore.rules.
 */
export interface FriendDirectoryEntry {
  label?: string; // Admin-assigned descriptive note / nickname (Unverified)
  email?: string; // Admin-entered contact email (Unverified note)
  addedAt: string;
}

export interface VaultConfig {
  vaultId: string;
  adminUids: string[];          // Internal authorization list only - NEVER expose in UI
  authorizedFriends: string[];  // Internal authorization list only - NEVER expose in UI
  friendDirectory?: {
    [uid: string]: FriendDirectoryEntry;
  };
  userDirectory?: {
    [uid: string]: {
      uid: string;
      email: string;
      displayName: string;
      photoURL?: string;
      role: 'admin' | 'friend' | 'pending' | 'ignored';
      lastLogin?: string;
      createdAt?: string;
    };
  };
  vaultName: string;
}

