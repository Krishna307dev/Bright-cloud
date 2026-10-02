/**
 * Folder rule representing vaults/{vaultId}/folderRules/{ruleId}.
 * Only Admin may query or write folderRules.
 * ruleId is deterministically computed as: {sourceId}__{encodeURIComponent(canonicalRelativePath)}
 */
export interface FolderRule {
  ruleId: string;
  sourceId: string;
  relativePath: string;         // Canonicalized with trailing slash (e.g. "Documents/Projects/")
  allowedFriends: string[];     // Internal authorization list only - NEVER expose in UI
  isPublicToFriends?: boolean;  // Folder-level public toggle
  status?: 'SYNCED' | 'PROPAGATING' | 'PARTIAL_ERROR' | 'DELETED' | 'DELETED_SYNCED';
  isDeleted?: boolean;          // Durable tombstone flag for deletion propagation
  fallbackTarget?: {            // Fallback policy computed during tombstone propagation
    isPublicToFriends: boolean;
    allowedFriends: string[];
  };
  propagationId?: string;       // Authoritative generation UUID
  ruleVersion?: number;         // Monotonically increasing generation number
  updatedAt: Date;
  deletedAt?: Date;
  syncedAt?: Date;
}
