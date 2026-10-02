/**
 * File record representing vaults/{vaultId}/files/{fileId}.
 * Master storage credentials and b2ObjectKey are strictly hidden server-side.
 */
export interface FileRecord {
  fileId: string;
  sourceId: string;
  relativePath: string;         // Canonical path with trailing slash (or "" for root)
  originalName: string;
  storedName: string;
  sha256: string;
  size: number;
  lastModified: number;
  mimeType?: string;
  version: number;
  status: 'UPLOADED';
  uploadedAt: Date;
  jobId: string;
  isPublicToFriends?: boolean;
  allowedFriends?: string[];    // Internal authorization list only - NEVER expose in UI
  customPermissions?: boolean;  // Explicit per-file permission override flag
  b2ObjectKey?: string;         // Canonical B2 object key (backups/{vaultId}/{sourceId}/{path}{name})
}
