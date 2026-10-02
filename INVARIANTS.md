# System Invariants

These invariants must hold true under ALL conditions including concurrent workers, duplicate USB events, crash recovery, retry, process death, reboot, and network failure.

Every implementation decision must be evaluated against these invariants.

---

## Content & Storage Invariants

### I-001: Existing cloud objects in Backblaze B2 are never overwritten
Once a file is successfully uploaded to Backblaze B2 at a specific object key (`backups/{uid}/{sourceId}/{relativePath}{storedName}`), that object and its binary bytes are permanent. No subsequent operation may overwrite, modify, or delete the object at that path.

**Enforcement**: Application-level. Firestore name reservations prevent path reuse.

**Recovery implication**: If a recovery operation detects that a Backblaze B2 object already exists at a path with a matching SHA-256 hash, it must NOT re-upload. It must finalize Firestore metadata directly.

---

### I-002: An exact SHA-256 is never uploaded twice for the same owner
If the Firestore `users/{uid}/contentHashes/{sha256}` document exists for the authenticated user, no upload of binary bytes with that hash should occur. The file is marked `SKIPPED_DUPLICATE` regardless of its filename.

**Enforcement**: Deduplication check queries `contentHashes/{sha256}` before any upload to Backblaze B2.

---

### I-003: A changed same-name file receives a new versioned filename
If file content is new (hash not in `contentHashes`) but the filename is already taken in the same `{sourceId}/{relativePath}/` scope, the file receives a versioned name: `name(1).ext`, `name(2).ext`, etc.

**Enforcement**: Firestore name reservation transaction checks for existing names and atomically reserves the next available version.

---

### I-004: An upload is not marked INDEXED before cloud confirmation
The Room `FileEntity.status` must not transition to `INDEXED` until:
1. Backblaze B2 has confirmed the byte stream upload.
2. Firestore metadata has been written (atomic finalization transaction).

The intermediate state `UPLOADED_NOT_INDEXED` exists for the window between Backblaze B2 upload success and Firestore finalization.

---

### I-005: A failed reservation cannot permanently consume a filename
If a name reservation (`nameReservations` document) has status `PENDING` and its `expiresAt` timestamp has passed (>24 hours), the reservation is expired and the name is available for reuse or overwrite by the same or next worker. Reservations with status `COMMITTED` are permanent.

**Enforcement**: 24-hour TTL on `PENDING` reservations. `ReconciliationWorker` and `VersionedNameResolver` handle expired lock reclamation.

---

### I-006: USB disconnection cannot corrupt durable queue state
If the USB drive is removed during any phase (scanning, hashing, uploading), the Room database must remain in a consistent state. Files in progress are marked `SOURCE_UNAVAILABLE`. Already-completed files remain in their final state.

**Enforcement**: All Room writes use transactions. `IOException` from file operations is caught and handled gracefully.

---

### I-007: Process death cannot permanently lose a queued backup job
If the Android process is killed during a backup, the job must be resumable when the process restarts. WorkManager re-schedules the work. Room contains the durable state needed to resume from the last successful step.

**Enforcement**: WorkManager persistence + Room state machine. Every state transition is written to Room before proceeding to the next step.

---

### I-008: Deduplication is content-based, never filename-based
Two files with different names but identical SHA-256 hashes are considered the same content. Only one copy is stored in Backblaze B2. Two files with the same name but different SHA-256 hashes are considered different content and both are stored with versioned filenames.

---

### I-009: No polling or permanent services for USB detection
The app does not use polling loops, timers, or permanent foreground/background services to detect USB attachment. It uses Android's event-driven USB broadcast mechanism and WorkManager for durable execution.

---

### I-010: All operations are idempotent or protected by durable state
Re-scanning the same USB drive produces the same file list (minus already-processed files). Re-hashing produces the same hash. Re-writing the same Firestore document with the same data is safe. Re-uploading to Backblaze B2 with identical content is idempotent.

---

### I-011: A crash must not produce duplicate version numbers
If the app crashes after uploading `CHAPTER_5(1).pdf` to Backblaze B2 but before finalizing Firestore metadata, recovery must NOT create `CHAPTER_5(2).pdf` for the same content. It must detect the existing B2 upload via `HeadObject` and finalize Firestore metadata.

---

### I-012: User ownership isolation is strictly enforced
All Firestore documents are nested under `users/{uid}/` and all Backblaze B2 objects are nested under `backups/{uid}/`. No cross-user access is permitted.

---

### I-013: No secrets embedded in the APK
The APK must not contain Firebase Admin SDK private keys or permanent full-access Backblaze B2 credentials. Only client-side configuration and scoped upload tokens/presigned URLs are used.

---

### I-014: Source USB files are never modified or deleted
The backup app is strictly read-only with respect to USB storage. It never writes to, modifies, or deletes files on the USB drive.

---

### I-015: Byte-for-Byte Fidelity (B2 Storage Invariant)
All files uploaded to Backblaze B2 must remain byte-for-byte identical to the source USB file. No compression, transcoding, format conversion, or byte alteration is permitted.
