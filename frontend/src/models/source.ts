/**
 * Source entity representing vaults/{vaultId}/sources/{sourceId}.
 * Represents a physical USB drive.
 */
export interface SourceEntity {
  sourceId: string;
  displayName: string;
  volumeUuid?: string;
  usbVendorId: number;
  usbProductId: number;
  serialNumber?: string;
  firstSeen: Date;
  lastSeen: Date;
  totalFilesBackedUp: number;
  rulesGeneration?: number; // Hierarchical generation counter for OCC locks
  status?: 'ACTIVE' | 'PENDING_DELETION';
  deletionExecuteAt?: Date;
}
