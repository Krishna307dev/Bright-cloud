# Cloud Consistency & Two-Phase Upload Protocol

## Problem Statement

Cloudflare R2 (binary object storage) and Cloud Firestore (metadata database) are separate services with **no cross-service ACID transaction**. An upload involves two distinct operations:

1. Upload file bytes to Cloudflare R2 (S3-compatible `PutObject`).
2. Write metadata to Firestore (file record, hash index, reservation commit).

Either can succeed while the other fails. The system must handle all partial-failure scenarios without creating duplicate files, losing data, or permanently blocking filenames.

---

## Upload Lifecycle

```text
1. File discovered on USB (Room: DISCOVERED)
     ↓
2. Smart Backup Policy check:
   ├── Category B (Metadata-only) ──► Write Firestore metadata ──► Room: METADATA_INDEXED
   └── Category A (Automatic) / Requested ──► Continue to Step 3
     ↓
3. Compute streaming SHA-256 (Room: HASHED)
     ↓
4. Deduplication Check (Firestore: users/{uid}/contentHashes/{sha256}):
   ├── Hash Exists ──► Room: SKIPPED_DUPLICATE
   └── Hash New ──► Continue to Step 5
     ↓
5. Reserve filename in Firestore transaction (Room: NAME_RESERVED)
     ↓
6. Upload file stream to Cloudflare R2 with custom metadata (x-amz-meta-sha256)
     ↓
7. R2 upload completes ──► Room: UPLOADED_NOT_INDEXED
     ↓
8. Finalize in Firestore transaction:
   - Create files/{fileId} document (status: "UPLOADED", storageBackend: "R2", r2ObjectKey: path)
   - Create contentHashes/{sha256} document (immutable)
   - Update nameReservations/{resId} status to "COMMITTED"
   - Update backupJob counters
     ↓
9. Update Room status to INDEXED
     ↓
10. DONE
```

---

## Local State (Room)

### UploadTaskEntity Tracks the Exact Phase

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | String | Primary key (UUID) |
| `fileId` | Long | FK to `FileEntity` |
| `state` | String | `RESERVING` / `RESERVED` / `UPLOADING` / `UPLOADED_NOT_INDEXED` / `INDEXED` / `FAILED` |
| `r2ObjectKey` | String | Reserved Cloudflare R2 path (`backups/{uid}/{sourceId}/{relativePath}{storedName}`) |
| `storageBackend` | String | `"R2"` |
| `uploadSessionUri` | String? | Multipart / S3 upload identifier |
| `reservationId` | String? | Firestore `nameReservations` document ID |
| `sha256` | String | Content hash |
| `attempt` | Int | Retry counter |
| `bytesTransferred` | Long | Upload progress in bytes |
| `totalBytes` | Long | Total file size in bytes |
| `lastError` | String? | Error message |
| `createdAt` | Long | Epoch millis |
| `updatedAt` | Long | Epoch millis |

---

## Critical Recovery State: `UPLOADED_NOT_INDEXED`

The `UPLOADED_NOT_INDEXED` state is the central resilience checkpoint:
- It indicates the file binary bytes exist safely in Cloudflare R2.
- Firestore metadata has not yet been finalized.
- When `ReconciliationWorker` or `BackupWorker` retries this task, it calls `CloudStorageRepository.checkObjectExists(r2ObjectKey)`.
- If the object exists and its `x-amz-meta-sha256` metadata matches the file's hash, byte upload is **skipped entirely**.
- The worker executes the Firestore finalization transaction immediately, advancing the state to `INDEXED`.
- **Zero Byte Re-Upload**: No bandwidth is wasted and no duplicate version names (`CHAPTER_5(1)(1).pdf`) are generated.

---

## Crash Scenarios and Recovery

### Scenario 1: Crash during reservation (`state = RESERVING`)
- **Recovery**: Check Firestore for the reservation document. If exists with our `jobId` and `sha256`, reuse it. If taken by another task, increment version number and re-reserve.

### Scenario 2: Crash after reservation, before upload (`state = RESERVED`)
- **Recovery**: Verify reservation is still valid (<24 hours old). If valid, proceed to Cloudflare R2 upload. If expired, re-reserve.

### Scenario 3: Crash during upload (`state = UPLOADING`)
- **Recovery**: Check Cloudflare R2 for object existence via `HeadObject`. If object exists with matching SHA-256 metadata, transition to `UPLOADED_NOT_INDEXED` and finalize. If object does not exist, re-upload byte stream from USB source.

### Scenario 4: Upload succeeded, crash before Firestore write (`state = UPLOADED_NOT_INDEXED`)
- **Recovery**: Verify Cloudflare R2 object exists with matching hash. Execute atomic Firestore finalization transaction to write `files`, `contentHashes`, and mark `nameReservations` as `COMMITTED`. Advance Room state to `INDEXED`.

---

## Finalization Invariants

1. **Never mark `INDEXED` before Cloudflare R2 confirmation and Firestore transaction commit.**
2. **Never write `contentHashes` before R2 upload succeeds.**
3. **Always verify object existence before re-uploading.**
4. **All recovery operations are idempotent and safe to execute multiple times.**
