# USBCloudBackup — Master Implementation Specification

> **Status**: FINAL / APPROVED FOR IMPLEMENTATION  
> **Target Platform**: Android 7.0 (API 24) to Android 16 (API 36), Kotlin, Jetpack, Firebase, Backblaze B2  
> **Architecture Version**: 3.0.0 (Shared Vault + Headless Anonymous Daemon + Google Web Access Control)  

---

## 1. System Overview

USBCloudBackup is a native Android background service application designed for automated, zero-interaction file backup from attached USB mass storage devices to Backblaze B2 object storage, coordinated by Cloud Firestore metadata.

The system decouples **Device Identity** from **Human Identity**:
1. **Physical Storage Anchor**: The physical pendrive (`sourceId = {vid}-{pid}-{volumeUuid}`) is the storage identity. Regardless of which friend's phone uploads the pendrive, files land in the **same directory** within the shared vault (`backups/{vaultId}/{sourceId}/...`).
2. **Android Background Daemon**: Uses Firebase Anonymous Authentication as an ephemeral device-agent credential. It is an **UPLOAD-ONLY** headless agent. It has zero human identity, zero Google sign-in, zero pairing codes, zero download capability, and zero delete capability.
3. **Web Viewer (Humans)**: Uses Google Authentication. Humans interact only via the browser.
   - **Owner / Admin**: Full control over metadata, files, manual web uploads, deletions, user whitelisting, and per-file/per-folder access rules.
   - **Friends / Viewers**: Read-only access restricted strictly to files and folders explicitly permitted by the Admin. Strictly prohibited from uploading, deleting, modifying metadata, or managing permissions.

---

## 2. Four Independent Identities

- **DEVICE UID**: Firebase Anonymous UID (`anon_xxx`). Upload-agent identity only (`DEVICE_UPLOAD`).
- **SOURCE ID**: Stable physical pendrive identity (`{vid}-{pid}-{volumeUuid}`).
- **GOOGLE UID**: Human web identity used in the browser for authentication and access control.
- **VAULT ID**: Logical shared storage and database namespace (`vaults/{vaultId}/` and `backups/{vaultId}/`).

---

## 3. Backblaze B2 Storage Schema

### Canonical Object Key
```text
backups/{vaultId}/{sourceId}/{relativePath}{storedName}
```

### S3 Custom Metadata Headers
- `x-amz-meta-sha256`: SHA-256 hash string (64-character lowercase hex).
- `x-amz-meta-source-id`: USB device fingerprint.
- `x-amz-meta-original-name`: Original USB filename.
- `x-amz-meta-file-id`: Firestore file document ID.

---

## 4. Cloud Firestore Schema

All collections are scoped under `vaults/{vaultId}/`:
- `vaults/{vaultId}/settings`: Admin UIDs, authorized friends list, metadata.
- `vaults/{vaultId}/sources/{sourceId}`: Physical USB device metadata.
- `vaults/{vaultId}/files/{fileId}`: File metadata (`isPublicToFriends`, `allowedFriends`, `b2ObjectKey`, `status`).
- `vaults/{vaultId}/contentHashes/{sha256}`: Deduplication index (**IMMUTABLE** after creation).
- `vaults/{vaultId}/backupJobs/{jobId}`: Backup job logs.
- `vaults/{vaultId}/nameReservations/{resId}`: Atomic filename reservation locks (24h TTL).
- `vaults/{vaultId}/folderRules/{ruleId}`: Granular folder-level permissions.

---

## 5. System Invariants

- **I-001**: Existing objects in Backblaze B2 are never overwritten.
- **I-002**: An exact SHA-256 is never uploaded twice for the same vault.
- **I-003**: A changed same-name file receives a new versioned filename (`name(1).ext`).
- **I-004**: An upload is not marked `INDEXED` before cloud confirmation and Firestore transaction commit.
- **I-005**: A failed filename reservation cannot permanently consume a filename (24h TTL).
- **I-006**: USB disconnection cannot corrupt durable queue state.
- **I-007**: Process death cannot permanently lose a queued backup job.
- **I-008**: Deduplication is content-based, never filename-based.
- **I-009**: No polling or permanent services for USB detection.
- **I-010**: All operations are idempotent or protected by durable state.
- **I-011**: A crash must not produce duplicate version numbers.
- **I-012**: Device ID != Human ID. Anonymous devices cannot download or delete files.
- **I-013**: No secrets embedded in the APK or Web frontend.
- **I-014**: Source USB files are never modified or deleted.
- **I-015**: Byte-for-Byte Fidelity: Binary files uploaded to Backblaze B2 are never compressed or transcoded.
