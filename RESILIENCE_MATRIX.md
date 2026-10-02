# USBCloudBackup — System Resilience Matrix

> **Version**: 1.0.0 (Phase 6 Architecture & Implementation Spec)  
> **Status**: APPROVED  

---

## 1. Overview & Core Recovery Principles

The system must maintain data integrity and strict invariant compliance under all failure conditions including process death, worker cancellation, USB disconnects, network drops, cloud service degradation, and system reboots.

### Core Recovery Principles
1. **Never Overwrite Cloud Data (`I-001`)**: Filenames in Cloud Storage are immutable once uploaded and indexed.
2. **Never Duplicate Content Uploads (`I-002`)**: If a content hash exists in Firestore `contentHashes/{sha256}`, byte upload is bypassed.
3. **Durable Local State Machine (`I-004`, `I-007`)**: Every state transition (`SCANNING` -> `HASHING` -> `DEDUPLICATING` -> `NAME_RESERVED` -> `UPLOADING` -> `UPLOADED_NOT_INDEXED` -> `INDEXED`) is committed to Room before proceeding to the next step.
4. **Idempotency & Ambiguity Resolution (`I-010`, `I-011`)**: Ambiguous cloud responses check `CloudStorageRepository.checkObjectExists()` for matching SHA-256 metadata before initiating a re-upload or generating new filename versions.
5. **USB Drive Read-Only Protection (`I-014`)**: USB storage is strictly read-only. Disconnection marks active files `SOURCE_UNAVAILABLE` without corrupting local DB state or modifying USB contents.

---

## 2. Comprehensive Failure & Recovery Scenario Matrix

| Category | Failure Trigger | Current State | Expected Durable State | Recovery Action | Retry Allowed? | Cloud Reconciliation Required? | USB Required? | Final State |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Local** | Process death during scan | `SCANNING` | `DISCOVERED` / `SCANNING` | `BackupWorker` restarts scan from beginning. Existing `DISCOVERED` entries merged. | Yes | No | Yes | `COMPLETED` |
| **Local** | Process death during hashing | `HASHING` | `HASHED` / `DISCOVERED` | `BackupWorker` resumes hashing for un-hashed files. Already hashed files retain `HASHED` state. | Yes | No | Yes | `COMPLETED` |
| **Local** | Worker cancellation (`isStopped`) | Any active state | Current Room state preserved | Worker exits loop gracefully; WorkManager reschedules per policy. | Yes | No | No (until resume) | Resumed / `COMPLETED` |
| **Local** | App crash / DB restart | Any active state | Preserved Room state | App re-opens; database integrity intact. WorkManager resumes job execution. | Yes | Yes (if in upload stage) | Yes | `COMPLETED` |
| **Local** | System reboot | Active job in Room | Preserved Room state | `BootReceiver` triggers `ReconciliationWorker` & `BackupWorkManager`. | Yes | Yes | Yes | `COMPLETED` |
| **USB** | Disconnect before scan | `SCANNING` | `SCANNING` / `FAILED` | `storageSource.isAvailable()` returns `false`. Job returns `Result.retry()`. | Yes | No | Yes | Retry / `COMPLETED` |
| **USB** | Disconnect during stream read | `HASHING` / `UPLOADING` | `SOURCE_UNAVAILABLE` | `IOException` caught; file marked `SOURCE_UNAVAILABLE`. Job remains active for retry when USB reconnected. | Yes | No | Yes | `SOURCE_UNAVAILABLE` -> `INDEXED` on reconnect |
| **USB** | Disconnect after upload, before Firestore | `UPLOADED_NOT_INDEXED` | `UPLOADED_NOT_INDEXED` | File byte upload succeeded. `ReconciliationWorker` checks Cloud Storage, finds object, and completes Firestore finalization without USB drive. | Yes | Yes | **No** | `INDEXED` |
| **USB** | Reconnect same USB drive | `SOURCE_UNAVAILABLE` / active | Matches existing `sourceId` | Resumes unfinished backup job. Already `INDEXED` or `SKIPPED_DUPLICATE` files skipped. | Yes | Yes | Yes | `COMPLETED` |
| **USB** | Reconnect different USB drive | Active job for original | Independent `sourceId` created | Creates new independent `BackupJob`. Original job remains queued for its own `sourceId`. | Yes | No | Yes | `COMPLETED` (per device) |
| **Network**| Network unavailable before upload | `NAME_RESERVED` | `NAME_RESERVED` | WorkManager `NetworkType.CONNECTED` constraint pauses worker until network restored. | Yes | No | No | `INDEXED` |
| **Network**| Network drops mid-upload | `UPLOADING` | `UPLOADING` / `NAME_RESERVED` | `CloudStorageRepository` saves `uploadSessionUri` in Room. Worker retries upload resumption using session URI. | Yes | No | Yes | `INDEXED` |
| **Network**| Network drops after Storage success | `UPLOADED_NOT_INDEXED` | `UPLOADED_NOT_INDEXED` | `ReconciliationWorker` or next worker run verifies Cloud Storage object metadata, executes Firestore finalization transaction. | Yes | Yes | No | `INDEXED` |
| **Network**| Network drops during Firestore tx | `UPLOADED_NOT_INDEXED` | `UPLOADED_NOT_INDEXED` | Firestore transaction is idempotent. Retry re-executes transaction on `users/{uid}/files` and `users/{uid}/contentHashes`. | Yes | Yes | No | `INDEXED` |
| **Cloud** | Auth token expired | Any cloud stage | Room state preserved | `AuthRepository.ensureAuthenticated()` re-authenticates anonymously or via refresh token before proceeding. | Yes | No | No | `INDEXED` |
| **Cloud** | Firestore permission denied | Any cloud stage | `FAILED` | `FirebaseErrorClassifier` classifies as `PERMANENT`. Job marked `FAILED`. No infinite retry. | No | No | No | `FAILED` |
| **Cloud** | Storage quota exceeded | `UPLOADING` | `FAILED` | `FirebaseErrorClassifier` classifies as `PERMANENT`. Job marked `FAILED`. | No | No | No | `FAILED` |
| **Cloud** | Storage succeeds, Firestore fails | `UPLOADED_NOT_INDEXED` | `UPLOADED_NOT_INDEXED` | Object exists in Storage. `ReconciliationWorker` re-runs `finalizeUploadTransaction` to write Firestore documents. | Yes | Yes | No | `INDEXED` |
| **Cloud** | Ambiguous upload result | `NAME_RESERVED` / `UPLOADING` | Preserved Room state | Queries `checkObjectExists(cloudPath)`. If hash matches, transitions to `UPLOADED_NOT_INDEXED` without re-uploading bytes. | Yes | Yes | No | `INDEXED` |
| **Reserve**| Pending reservation exists | `NAME_RESERVED` | `NAME_RESERVED` | If `expiresAt > currentTime` and `sha256` & `jobId` match, `VersionedNameResolver` reuses existing reservation ID and name. | Yes | Yes | No | `INDEXED` |
| **Reserve**| Reservation expires (>24h TTL) | `NAME_RESERVED` (expired) | Available for claim | `VersionedNameResolver` overwrites expired `PENDING` reservation with new reservation. | Yes | Yes | No | `INDEXED` |
| **Reserve**| Crash after reservation created | `NAME_RESERVED` | `NAME_RESERVED` | On restart, worker loads `UploadTask` from Room, reuses reserved `b2ObjectKey` and `storedName`. | Yes | Yes | No | `INDEXED` |

---

## 3. Invariant Enforcement Summary (`INVARIANTS.md`)

- **`I-001` (Cloud Objects Immutable)**: Enforced via `VersionedNameResolver` Firestore reservation transaction.
- **`I-002` (Single SHA-256 Upload)**: Enforced via `users/{uid}/contentHashes/{sha256}` lookup in `CloudRecoveryEngine.checkCloudDeduplication()`.
- **`I-003` (Versioned Filenames)**: Enforced via `ReservationUtils.formatStoredName()` (`CHAPTER_5(1).pdf`).
- **`I-004` (State Confirmation Boundary)**: `FileStatus` reaches `INDEXED` only after Firestore finalization transaction succeeds.
- **`I-005` (24h Reservation TTL)**: `PENDING` reservations expire after 24 hours (`currentTime + 24 * 60 * 60 * 1000L`).
- **`I-006` (USB Disconnect Safety)**: `IOException` on stream read catches detachment, setting status to `SOURCE_UNAVAILABLE` while keeping Room queue consistent.
- **`I-007` (Process Death Recovery)**: WorkManager + Room state machine persists step state before execution.
- **`I-008` (Content-Based Deduplication)**: SHA-256 hash is computed prior to cloud upload decisions.
- **`I-009` (No Polling / Permanent Idle Services)**: Purely event-driven WorkManager design.
- **`I-010` (Idempotency)**: Re-execution of recovery engines produces identical outputs.
- **`I-011` (No Duplicate Versions on Crash)**: Re-runs check `checkObjectExists` and reuse `UploadTask.reservationId`.
- **`I-012` (Owner Isolation)**: Enforced via Firestore `/users/{uid}/` and Cloud Storage `backups/{uid}/` rules.
- **`I-013` (No Secrets in APK)**: Only client-side `google-services.json` used.
- **`I-014` (USB Read-Only)**: Standard read streams (`openInputStream()`), no write access to USB drives.
