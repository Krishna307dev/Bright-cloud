# Data Model

## Room Entities (Local Persistent Store)

The local SQLite database (via Room) holds operational queue state, progress tracking, and crash-recovery metadata.

---

### 1. `SourceEntity`
Represents a physical USB storage drive.
- `sourceId: String` (Primary Key: `{vendorId}-{productId}-{volumeUuid}`)
- `usbVendorId: Int`
- `usbProductId: Int`
- `serialNumber: String?`
- `volumeUuid: String?`
- `displayName: String`
- `firstSeen: Long` (Epoch millis)
- `lastSeen: Long` (Epoch millis)

---

### 2. `BackupJobEntity`
Tracks a backup session triggered by USB attachment.
- `jobId: String` (Primary Key, UUID)
- `sourceId: String` (Foreign Key -> `SourceEntity`)
- `vaultId: String` (Target vault, e.g. `"default"`)
- `state: String` (`SCANNING`, `HASHING`, `DEDUPLICATING`, `UPLOADING`, `COMPLETED`, `FAILED`, `CANCELLED`)
- `startedAt: Long`
- `completedAt: Long?`
- `totalFiles: Int`
- `uploadedFiles: Int`
- `skippedFiles: Int`
- `errorFiles: Int`

---

### 3. `FileEntity`
Records metadata for individual files discovered on the USB device.
- `id: Long` (Primary Key, Auto-increment)
- `jobId: String` (Foreign Key -> `BackupJobEntity`)
- `sourceId: String`
- `vaultId: String`
- `relativePath: String` (Path from USB root, e.g., `"Photos/2026/"`)
- `originalName: String`
- `extension: String` (Lowercase extension, e.g., `"pdf"`, `"mp4"`)
- `cloudFilename: String?` (Assigned after name reservation, e.g., `"document(1).pdf"`)
- `sha256: String?` (64-character lowercase hex string)
- `size: Long` (Bytes)
- `lastModified: Long` (Epoch millis)
- `mimeType: String?`
- `backupMode: String` (`"AUTOMATIC"`, `"MANUAL"`)
- `b2ObjectKey: String?` (Full Backblaze B2 object key: `backups/{vaultId}/{sourceId}/{relativePath}{storedName}`)
- `storageBackend: String` (Default `"B2"`)
- `status: String` (`DISCOVERED`, `HASHING`, `HASHED`, `SKIPPED_DUPLICATE`, `NAME_RESERVING`, `NAME_RESERVED`, `UPLOADING`, `UPLOADED_NOT_INDEXED`, `INDEXED`, `FAILED`, `SOURCE_UNAVAILABLE`)
- `retryCount: Int` (Default 0)
- `errorMessage: String?`

---

### 4. `UploadTaskEntity`
Tracks active and resumable Backblaze B2 upload executions.
- `taskId: String` (Primary Key, UUID)
- `fileId: Long` (Foreign Key -> `FileEntity`)
- `state: String` (`RESERVING`, `RESERVED`, `UPLOADING`, `UPLOADED_NOT_INDEXED`, `INDEXED`, `FAILED`)
- `b2ObjectKey: String?`
- `uploadSessionUri: String?` (Direct SigV4 Presigned URL)
- `reservationId: String?`
- `sha256: String?`
- `attempt: Int`
- `bytesTransferred: Long`
- `totalBytes: Long`
- `lastError: String?`
- `createdAt: Long`
- `updatedAt: Long`

---

### 5. `NameReservationEntity`
Local cache of atomic filename version reservations.
- `reservationId: String` (Primary Key: `{vaultId}_{sourceId}_{relativePath}_{storedName}`)
- `sha256: String`
- `b2ObjectKey: String`
- `vaultId: String`
- `sourceId: String`
- `relativePath: String`
- `originalName: String`
- `storedName: String`
- `version: Int`
- `status: String` (`PENDING`, `COMMITTED`, `EXPIRED`)
- `jobId: String`
- `ownerTaskId: String`
- `createdAt: Long`
- `expiresAt: Long`

---

## Cloud Data Model (Firestore)

All cloud data is scoped under `vaults/{vaultId}/`:

- **`vaults/{vaultId}/settings`**:
  - `adminUids: string[]` (Google UIDs with full owner/admin control)
  - `authorizedFriends: string[]` (Whitelisted Google UIDs with viewer privileges)
  - `createdAt: timestamp`
  - `updatedAt: timestamp`

- **`vaults/{vaultId}/sources/{sourceId}`**:
  - `sourceId: string` (`{vendorId}-{productId}-{volumeUuid}`)
  - `volumeUuid: string?`
  - `usbVendorId: number`
  - `usbProductId: number`
  - `serialNumber: string?`
  - `displayName: string`
  - `firstSeen: timestamp`
  - `lastSeen: timestamp`
  - `totalFilesBackedUp: number`

- **`vaults/{vaultId}/files/{fileId}`**:
  - `fileId: string` (Unique ID)
  - `sourceId: string`
  - `relativePath: string`
  - `originalName: string`
  - `storedName: string`
  - `b2ObjectKey: string` (`backups/{vaultId}/{sourceId}/{relativePath}{storedName}`)
  - `storageBackend: string` (`"B2"`)
  - `sha256: string`
  - `size: number`
  - `lastModified: number`
  - `mimeType: string?`
  - `version: number`
  - `status: string` (`"UPLOADED"`)
  - `uploadedAt: timestamp`
  - `jobId: string`
  - `isPublicToFriends: boolean` (Default `true`)
  - `allowedFriends: string[]` (Explicit list of friend Google UIDs granted access)

- **`vaults/{vaultId}/contentHashes/{sha256}`**:
  - `sha256: string` (Document ID)
  - `fileId: string`
  - `b2ObjectKey: string`
  - `storageBackend: string` (`"B2"`)
  - `size: number`
  - `storedName: string`
  - `uploadedAt: timestamp`
  - **IMMUTABLE after creation**.

- **`vaults/{vaultId}/backupJobs/{jobId}`**:
  - `jobId: string`
  - `sourceId: string`
  - `state: string`
  - `startedAt: timestamp`
  - `completedAt: timestamp?`
  - `totalFiles: number`
  - `hashedFiles: number`
  - `skippedFiles: number`
  - `uploadedFiles: number`
  - `errorFiles: number`
  - `error: string?`

- **`vaults/{vaultId}/nameReservations/{resId}`**:
  - `reservationId: string`
  - `sha256: string`
  - `b2ObjectKey: string`
  - `sourceId: string`
  - `relativePath: string`
  - `originalName: string`
  - `storedName: string`
  - `status: string` (`"PENDING"`, `"COMMITTED"`, `"EXPIRED"`)
  - `jobId: string`
  - `createdAt: timestamp`
  - `expiresAt: timestamp` (24-hour TTL)

- **`vaults/{vaultId}/folderRules/{ruleId}`**:
  - `folderRuleId: string`
  - `relativePath: string` (e.g. `"Projects/Confidential/"`)
  - `allowedFriends: string[]`
  - `updatedAt: timestamp`

---

## Indexing
- `FileEntity`: Index on `(jobId, status)` for fast worker queue processing.
- `FileEntity`: Index on `sha256` for local hash cache queries.
- `BackupJobEntity`: Index on `state` for incomplete job recovery.

