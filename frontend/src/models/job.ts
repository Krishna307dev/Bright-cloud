/**
 * Backup job record representing vaults/{vaultId}/backupJobs/{jobId}.
 */
export interface BackupJob {
  jobId: string;
  sourceId: string;
  state: 'SCANNING' | 'HASHING' | 'DEDUPLICATING' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt: Date;
  completedAt?: Date;
  totalFiles: number;
  hashedFiles?: number;
  skippedFiles: number;
  uploadedFiles: number;
  errorFiles: number;
  error?: string;
}

export interface ContentHashRecord {
  sha256: string;
  storedName: string;
  originalName: string;
  sourceId: string;
  relativePath: string;
  size: number;
  uploadedAt: Date;
  fileId: string;
  b2ObjectKey?: string;
}
