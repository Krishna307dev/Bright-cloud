# Context Audit

> **Date**: 2026-08-11
> **Documentation files read**: 23/23
> **Research sources**: Android official documentation, Firebase official documentation, AndroidX documentation, Context7 library docs, web research of current API behavior

---

## 1. Confirmed Architecture

### Overall System Design — CONFIRMED

The system is an **event-driven, crash-resilient backup pipeline** for a single private Android user.

```text
USB ATTACHED
    → UsbEventReceiver (BroadcastReceiver)
    → UsbDeviceCoordinator (identify mass storage, request permission)
    → StorageAccessAdapter (SAF / DocumentProvider)
    → FileScanner (recursive traversal → FileEntity records)
    → SHA256Hasher (streaming hash → HASHED)
    → BackupDecisionEngine
        ├── hash exists → SKIPPED_DUPLICATE
        ├── hash new + name free → original name
        └── hash new + name exists → versioned name (1), (2), (3)...
    → UploadWorker (Cloud Storage putStream → Firestore metadata)
    → DONE → IDLE
```

**Classification**: CONFIRMED — The architecture is sound and follows Android best practices for event-driven background work.

### Layering — CONFIRMED

The architecture correctly separates concerns:
- **Android Framework Layer**: USB APIs, SAF, BroadcastReceiver, WorkManager
- **Gateway/Adapter Layer**: UsbGateway, StorageAccessAdapter, CloudRepository
- **Domain Layer**: BackupDecisionEngine, DeduplicationEngine, VersionedNameResolver
- **Data Layer**: Room (local queue), Firebase (remote storage + index)

This enables unit testing without hardware dependencies.

### Data Flow — CONFIRMED

```text
Room = operational queue and crash-recovery state
Firestore = durable remote index (hash→path, filename reservations)
Cloud Storage = actual file bytes
```

Upload-then-index ordering is correct: an unindexed uploaded file is recoverable; an indexed non-uploaded file is not.

### State Machine — CONFIRMED

```text
DISCOVERED → HASHING → HASHED → SKIPPED_DUPLICATE
                              → NAME_RESERVED → QUEUED → UPLOADING → UPLOADED
                                                                   → RETRY_WAIT → QUEUED
                                                                   → FAILED
                                              → SOURCE_UNAVAILABLE
```

The NAME_RESERVED state is important for crash recovery between Firestore reservation and upload initiation.

### Data Model — CONFIRMED (with issues, see §3)

Four Room entities: SourceEntity, FileEntity, BackupJobEntity, UploadTaskEntity.

---

## 2. Confirmed Requirements

| Requirement | Status | Notes |
|---|---|---|
| FR-001: First-run setup | CONFIRMED | Minimal Activity, one-time |
| FR-002: USB detection | CONFIRMED | USB Host API, class 8 filter |
| FR-003: Device identity | CONFIRMED | vendor/product/serial fingerprint |
| FR-004: Recursive scan | CONFIRMED | SAF-based traversal |
| FR-005: SHA-256 hashing | CONFIRMED | Streaming MessageDigest |
| FR-006: Global dedup | CONFIRMED | Content-based, cross-device |
| FR-007: Version naming | CONFIRMED | (1), (2), (3) suffixes |
| FR-008: Directory preservation | CONFIRMED | Cloud path mirrors USB structure |
| FR-009: Crash safety | CONFIRMED | Room persistence at every transition |
| FR-010: Retry | CONFIRMED | WorkManager + per-file retry count |
| FR-011: USB removal handling | CONFIRMED | SOURCE_UNAVAILABLE state |
| FR-012: No continuous UI | CONFIRMED | Background event-driven |
| FR-013: Boot resilience | CONFIRMED | WorkManager re-schedules + BOOT_COMPLETED |
| FR-014: Private deployment | CONFIRMED | Single owner, Firebase security rules |

**Classification**: CONFIRMED — All functional requirements are achievable, subject to platform limitations documented below.

---

## 3. Potential Contradictions

### C-1: Firebase KTX module deprecation

**Severity**: HIGH
**Classification**: REQUIRES OFFICIAL-DOC VERIFICATION → CONFIRMED by research

BUILD_AND_TOOLCHAIN.md and other docs reference:
```text
firebase-auth-ktx
firebase-storage-ktx
firebase-firestore-ktx
```

**Finding**: Firebase BoM 34.0.0+ (current: 34.17.0) has **removed KTX modules**. The Kotlin extensions are now merged into the main modules. The correct dependencies are:
```text
firebase-auth
firebase-storage
firebase-firestore
```

Using `-ktx` suffixes will either fail to resolve or pull deprecated/removed artifacts.

**Action**: Update BUILD_AND_TOOLCHAIN.md and all Firebase dependency references.

---

### C-2: Firestore collection structure inconsistency

**Severity**: MEDIUM
**Classification**: CONFIRMED

CLOUD_BACKEND.md defines a flat collection structure:
```text
users/{uid}
sources/{sourceId}
files/{fileId}
contentHashes/{sha256}
backupJobs/{jobId}
```

But SECURITY.md defines security rules as:
```text
match /users/{userId}/{document=**} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

If `contentHashes`, `files`, `sources`, and `backupJobs` are top-level collections (not subcollections of `users/{uid}`), the security rules in SECURITY.md will not protect them. The rules only cover documents nested under `users/{userId}/`.

**Resolution required**: Either:
1. Make all collections subcollections of `users/{uid}` — simpler security, matches SECURITY.md rules
2. Keep flat structure — write separate security rules for each top-level collection with `ownerUid` field validation

CLOUD_BACKEND.md says "Security rules must ensure one private owner cannot read/write another owner's records" but the flat structure makes this harder to enforce.

**Action**: Decide on collection hierarchy and update both CLOUD_BACKEND.md and SECURITY.md to be consistent.

---

### C-3: Cloud Storage path structure inconsistency

**Severity**: MEDIUM
**Classification**: CONFIRMED

CLOUD_BACKEND.md suggests:
```text
backups/{ownerUid}/{sourceId}/{relative-directory}/filename.ext
```

REQUIREMENTS.md FR-008 suggests:
```text
USB/{device-id}/Notes/Math/CHAPTER_5.pdf
```

ARCHITECTURE.md batch version suggested:
```text
users/{userId}/backups/filename.ext
```

Three different path structures across the documentation.

**Action**: Settle on one canonical Cloud Storage path structure and document it.

---

### C-4: CLOUD_BACKEND.md unresolved TODO

**Severity**: HIGH
**Classification**: CONFIRMED

CLOUD_BACKEND.md contains:
```text
TODO: consider using Cloud Storage object metadata to store hash for recovery
```

This is about recovery when Firestore write fails after a successful Cloud Storage upload. The doc acknowledges the problem but proposes no solution. The current fallback — "the hash check will miss and attempt re-upload" — could result in the same content being uploaded twice to different paths, violating the dedup principle.

**Action**: Resolve this TODO. Recommended: store SHA-256 as custom metadata on the Cloud Storage object. On recovery, check Cloud Storage object metadata before re-uploading.

---

### C-5: Worker chain design — sequential phases vs streaming pipeline

**Severity**: LOW
**Classification**: LIKELY (design tension, not contradiction)

ARCHITECTURE.md describes the pipeline as sequential stages (scan all → hash all → dedup all → upload all). For USB drives with thousands of files, this means:
1. All files must be scanned before any hashing begins
2. All files must be hashed before any deduplication begins
3. All files must be deduplicated before any uploading begins

This can lead to long delays before the first upload starts and increases the risk window for USB disconnection.

BACKGROUND_EXECUTION.md suggests the chain design "should depend on transaction boundaries and memory constraints" and could be one worker or multiple.

**Action**: Consider a streaming/pipeline approach where files flow through stages individually or in batches. Document the decision.

---

### C-6: `archive.tar.gz` versioning produces `archive.tar(1).gz`

**Severity**: LOW
**Classification**: UNCERTAIN — intentional but arguably surprising

VERSIONING_AND_NAMING.md specifies:
```text
archive.tar.gz → archive.tar(1).gz
```

This splits on the last `.` only. The intent appears deliberate but could surprise users who expect `archive(1).tar.gz`.

**Action**: Confirm this is the desired behavior and document the rationale. Consider splitting on the first `.` after the basename instead.

---

## 4. Android Platform Risks

### R-1: SAF requires user interaction for USB volume access

**Severity**: CRITICAL
**Classification**: CONFIRMED

The Storage Access Framework requires the user to select a directory root via `ACTION_OPEN_DOCUMENT_TREE`. This is fundamentally at odds with "zero-interaction after setup."

**Details**:
- Android 11+ enforces Scoped Storage. Direct `/storage/XXXX-XXXX/` access requires `MANAGE_EXTERNAL_STORAGE` permission.
- `MANAGE_EXTERNAL_STORAGE` requires Play Store justification (acceptable for backup apps, but this is a private sideloaded APK).
- SAF persistent URI permissions survive reboots but are **per-volume**. Each new USB drive requires a new grant.
- `StorageVolume.createOpenDocumentTreeIntent()` (API 29+) pre-navigates to the volume, reducing interaction to one tap, but still requires user action.
- Maximum 128 persisted URI permissions per app on Android 11+.

**Options**:
1. **SAF with one-time per-volume grant**: User selects each new USB drive's root once. Permission persists across reconnections of the same drive. App detects when a new/unrecognized volume appears and prompts user via notification.
2. **`MANAGE_EXTERNAL_STORAGE`**: Allows direct `java.io.File` access to USB mount points. No user interaction needed per-volume. Significantly faster file enumeration. But requires Play Store policy justification (not relevant for private sideloaded APK).
3. **Hybrid**: Try `MANAGE_EXTERNAL_STORAGE` first (request during setup), fall back to SAF.

**Recommendation**: For a private sideloaded app, `MANAGE_EXTERNAL_STORAGE` is the most practical approach. It avoids per-volume user interaction and enables much faster file enumeration. Document this decision.

---

### R-2: USB_DEVICE_DETACHED unreliable via manifest receiver

**Severity**: MEDIUM
**Classification**: CONFIRMED

`USB_DEVICE_DETACHED` is not reliably delivered to manifest-registered receivers on all devices. Must be registered dynamically via `registerReceiver()` in code.

**Impact**: The detach receiver must be registered in a running component (Activity, Service, or worker). If no component is running when the USB is removed, the detach event is missed.

**Mitigation**:
- Register the detach receiver dynamically when the backup worker starts.
- Also detect USB removal via IOException during file operations.
- On worker restart, check USB device availability before resuming.

---

### R-3: USB permission is per-connection

**Severity**: MEDIUM
**Classification**: CONFIRMED

USB device permission (via `UsbManager.requestPermission()`) is revoked when the device is disconnected. Must be re-requested each time.

**Mitigation**: The `usb_device_filter.xml` mechanism combined with an Activity intent filter can provide auto-grant behavior when the user checks "always open with this app." However:
- This launches the Activity each time, which conflicts with "no UI after setup."
- The user must explicitly select this option once per device.

**Recommendation**: Accept that USB permission dialog may appear on each connection. Show a brief, fast-dismiss activity that handles the permission and immediately delegates to the background worker. Or use the `usb_device_filter.xml` Activity approach to get auto-grant.

---

### R-4: Android 15+ dataSync foreground service timeout

**Severity**: MEDIUM
**Classification**: CONFIRMED

`dataSync` foreground services are limited to **6 hours per 24-hour period** on Android 15+. After timeout, the system calls `onTimeout()` and stops the service.

**Impact**: Very large backup jobs (thousands of large files over slow network) might exceed 6 hours.

**Mitigation**:
- Process files in batches with separate work requests.
- Each batch runs as a shorter foreground service session.
- Use WorkManager chaining or re-enqueueing to continue after each batch.
- Track progress in Room so work can resume across batches.

---

### R-5: Android 15+ restricts FGS launch from BOOT_COMPLETED

**Severity**: HIGH
**Classification**: LIKELY — REQUIRES OFFICIAL-DOC VERIFICATION

Research indicates that Android 15 may throw `ForegroundServiceStartNotAllowedException` when launching `dataSync` foreground services from a `BOOT_COMPLETED` receiver.

**Impact**: The boot recovery mechanism described in BACKGROUND_EXECUTION.md may fail on Android 15+.

**Mitigation**:
- Use WorkManager exclusively for post-boot recovery. WorkManager can reschedule work internally without launching a foreground service directly from the receiver.
- The BOOT_COMPLETED receiver should only enqueue WorkManager work, not start services directly.
- WorkManager itself handles foreground service promotion correctly even when launched from background.

**Action**: REQUIRES OFFICIAL-DOC VERIFICATION against Android 15/16 release notes.

---

### R-6: OEM battery optimization can prevent WorkManager and BOOT_COMPLETED

**Severity**: MEDIUM
**Classification**: CONFIRMED

Manufacturers including Xiaomi, Huawei, Oppo, Vivo, and Samsung impose proprietary battery optimization that can:
- Prevent BOOT_COMPLETED delivery
- Prevent WorkManager from executing background work
- Kill background processes aggressively
- Require user to manually whitelist the app in battery settings

**Mitigation**:
- During setup, check if the device has known aggressive battery optimization.
- Guide the user to whitelist the app (provide deep links to OEM battery settings where possible).
- Document this as a known device-dependent limitation.
- Do not attempt to bypass OEM restrictions with hidden APIs.

---

### R-7: DocumentFile.listFiles() performance

**Severity**: MEDIUM
**Classification**: CONFIRMED

`DocumentFile.listFiles()` is **extremely slow** — up to 100x slower than `java.io.File.listFiles()`. Each call triggers a separate IPC ContentProvider query.

**Mitigation**:
- Use `ContentResolver.query()` with `DocumentsContract.buildChildDocumentsUri()` directly.
- Fetch `COLUMN_DOCUMENT_ID`, `COLUMN_DISPLAY_NAME`, `COLUMN_MIME_TYPE`, `COLUMN_SIZE`, `COLUMN_LAST_MODIFIED` in a single projection.
- Batch results into Room rather than holding in memory.
- If using `MANAGE_EXTERNAL_STORAGE` approach, use `java.io.File` directly for much better performance.

---

### R-8: PendingIntent mutability (Android 12+)

**Severity**: LOW
**Classification**: CONFIRMED

Android 12+ requires PendingIntents to specify `FLAG_IMMUTABLE` or `FLAG_MUTABLE`. The USB permission request uses a PendingIntent.

**Action**: Ensure `PendingIntent.getBroadcast()` calls for USB permission include `PendingIntent.FLAG_IMMUTABLE`.

---

## 5. USB Storage Risks

### U-1: USB Host mode is device-dependent

**Classification**: CONFIRMED

Not all Android devices support USB Host mode. Budget phones may lack hardware support. USB OTG adapters are required on devices with USB-C but no dedicated USB-A port.

**Mitigation**:
- Declare `<uses-feature android:name="android.hardware.usb.host" android:required="true" />` in manifest.
- Check `UsbManager.getDeviceList()` and `PackageManager.hasSystemFeature()` during setup.
- Clearly communicate device requirements to the user.

---

### U-2: Mass storage detection heuristics

**Classification**: LIKELY

Not all USB devices with interface class 8 (mass storage) will be automatically mounted as accessible storage volumes by Android. Some devices may:
- Be recognized as USB but not mounted as storage
- Require explicit mount by the user (some OEMs show a notification)
- Use MTP/PTP instead of mass storage class
- Have multiple interfaces where only some are mass storage

**Mitigation**:
- Check all interfaces on the UsbDevice for class 8.
- Verify that a corresponding StorageVolume appears via `StorageManager.getStorageVolumes()`.
- Handle the case where USB is detected but storage is not accessible.

---

### U-3: Filesystem variety

**Classification**: REQUIRES DEVICE TEST

USB drives may use FAT32, exFAT, NTFS, ext4, or other filesystems. Android's kernel-level support varies:
- FAT32: universally supported
- exFAT: supported on most modern devices (Android 10+)
- NTFS: limited/no support on most devices without third-party drivers
- ext4: not typically supported for removable media

**Impact**: Files on unsupported filesystems will not be accessible regardless of the access method used.

**Action**: Document supported filesystems. Test with FAT32 and exFAT at minimum.

---

### U-4: Large USB drives

**Classification**: REQUIRES DEVICE TEST

USB drives > 2TB, drives with very deep directory structures, or drives with hundreds of thousands of files may expose edge cases in:
- SAF traversal performance
- Room database size
- Memory usage during scanning
- WorkManager data limits

**Action**: Test with USB drives containing at least 10,000 files in complex directory structures.

---

### U-5: File changes during backup

**Classification**: CONFIRMED (documented, mitigation specified)

Files on the USB drive could be modified by another device/system between scanning and hashing or between hashing and uploading.

**Documented mitigation**: Capture size/lastModified before hashing, verify after hashing. If changed, re-hash.

**Remaining risk**: The USB drive could be written to by another device while the phone is backing it up. This is unlikely in practice but should be handled gracefully.

---

### U-6: Unicode and special characters in filenames

**Classification**: REQUIRES DEVICE TEST

USB drives may contain filenames with:
- Unicode characters (CJK, Arabic, emoji)
- Spaces and special characters
- Very long filenames (>255 chars)
- Characters invalid in Cloud Storage paths (`#`, `?`, `[`, `]`, `*`)

**Action**: Implement filename sanitization for Cloud Storage paths while preserving the original filename in Firestore metadata. Test with diverse filename sets.

---

## 6. Firebase Risks

### F-1: No cross-service atomicity

**Severity**: HIGH
**Classification**: CONFIRMED

Cloud Storage upload and Firestore metadata write are two separate operations with no atomic cross-service transaction.

**Failure scenarios**:
1. **Upload succeeds, Firestore write fails**: File exists in Cloud Storage but is unindexed. On next scan, the hash check misses and the app may re-upload, creating a duplicate at a different path.
2. **Firestore reservation succeeds, upload fails**: Ghost reservation. Filename slot is occupied but no file exists.
3. **App crash after upload, before Firestore write**: Same as scenario 1.

**Mitigations**:
- Store SHA-256 as custom metadata on the Cloud Storage object for recovery verification.
- On recovery, check Cloud Storage for existing objects before re-uploading.
- Use a `status` field on Firestore name reservations (`pending` → `completed`). Implement cleanup for stale `pending` reservations.
- Make Firestore writes idempotent using `set()` with merge for hash index entries.

---

### F-2: Firestore transactions require network

**Severity**: MEDIUM
**Classification**: CONFIRMED

`runTransaction()` fails when offline. This affects:
- Deduplication check (hash index lookup) — can use offline cache for reads but transaction commits require network
- Filename reservation (atomic read-write) — requires network

**Impact**: Files can be scanned and hashed offline, but deduplication and upload require network.

**Mitigation**:
- Split the pipeline: scanning and hashing proceed offline, files queue at HASHED state.
- Deduplication, name reservation, and upload run when network is available via WorkManager network constraint.
- Use Firestore's offline cache for optimistic dedup checks (may give stale results, must verify on transaction commit).

---

### F-3: Cloud Storage has no conditional writes

**Severity**: HIGH
**Classification**: CONFIRMED

`putFile()`/`putStream()` will **overwrite** any existing object at the same path without warning. The "never overwrite" policy cannot be enforced at the Cloud Storage level.

**Impact**: If two workers or two app instances upload to the same path concurrently (or if recovery logic re-uploads to an existing path), the existing file will be silently overwritten.

**Mitigation**:
- All path resolution must go through Firestore transactions first.
- Before uploading, verify the path is reserved for this specific file.
- On recovery, check if the object already exists and has correct metadata before re-uploading.
- Consider using Cloud Storage [generation conditions](https://cloud.google.com/storage/docs/request-preconditions) via the underlying GCS API if exposed through the Firebase SDK (REQUIRES OFFICIAL-DOC VERIFICATION).

---

### F-4: Upload tasks don't survive process death

**Severity**: HIGH
**Classification**: CONFIRMED

Firebase Storage `UploadTask` objects are lost when the process dies. There is no built-in persistence of upload state across process boundaries.

**Research finding**: Upload tasks can persist their **session URI** for manual resume, but this requires the app to explicitly save it to persistent storage.

**Impact**: If the process is killed during a large file upload, the upload must restart from the beginning.

**Mitigation**:
- Save the upload session URI to Room before starting upload.
- On worker restart, attempt to resume using the saved session URI.
- If resume fails, restart the upload from scratch.
- For very large files, this could waste significant bandwidth. Accept this as a known limitation.

---

### F-5: Anonymous auth data loss

**Severity**: MEDIUM
**Classification**: CONFIRMED

Anonymous Firebase auth creates a temporary UID. If app data is cleared, the device is factory reset, or the app is uninstalled, the UID is lost and all cloud data becomes inaccessible.

**Mitigation**:
- Warn the user prominently during setup.
- Offer email/password upgrade via `linkWithCredential()` to persist the account.
- Consider making email auth the recommended option, with anonymous auth as a quick-start fallback.

---

### F-6: Firestore free tier limits

**Severity**: LOW
**Classification**: CONFIRMED

Spark plan (free tier):
- 1 GB Firestore storage
- 20K writes/day
- 50K reads/day
- 20K deletes/day

**Impact**: A single backup of a USB drive with 10,000 files would require ~30,000-40,000 Firestore writes (file records + hash index + job updates). This could exceed the daily write limit on the free tier.

**Mitigation**:
- Upgrade to Blaze plan (pay-as-you-go) for production use.
- Batch Firestore writes using WriteBatch (500 ops max per batch).
- Document free tier limitations and quota implications.

---

### F-7: Firestore security rules don't prevent metadata overwrites

**Severity**: MEDIUM
**Classification**: CONFIRMED

The current security rules allow `write` (create + update + delete). This means:
- A bug could overwrite existing metadata.
- Crash recovery logic that uses `set()` instead of `create()` could silently overwrite.

**Mitigation**: Use more granular rules:
```text
allow create: if request.auth != null && request.auth.uid == userId;
allow read: if request.auth != null && request.auth.uid == userId;
allow update: if request.auth != null && request.auth.uid == userId
               && (specific field validation);
allow delete: if false;
```

Make hash index documents immutable after creation. Allow updates only to specific fields (e.g., status) on file metadata documents.

---

## 7. Background Execution Risks

### B-1: BroadcastReceiver cannot do long-running work

**Classification**: CONFIRMED

BroadcastReceiver's `onReceive()` has a ~10-second execution limit. It must delegate to WorkManager immediately.

**Mitigation**: Already specified in the architecture. The receiver should only:
1. Extract USB device info from the intent.
2. Enqueue a unique WorkManager work chain.
3. Return.

---

### B-2: Multiple USB events for same device

**Classification**: LIKELY

The same USB device may generate multiple ATTACHED events (e.g., due to USB port issues, cable wiggle, or OEM behavior).

**Mitigation**:
- Use `WorkManager.enqueueUniqueWork()` with `ExistingWorkPolicy.KEEP`.
- Include USB device identifier in the work name.
- Idempotent processing: files already in UPLOADED/SKIPPED state are not reprocessed.

---

### B-3: Concurrent backups from different USB devices

**Classification**: UNCERTAIN — decision not made

What happens if two different USB devices are connected simultaneously (via USB hub)?

**Recommendation**: Support concurrent backups by using different unique work names per USB device. Each device gets its own WorkManager chain. Room database handles both concurrently.

**Action**: Document this decision in DECISIONS.md.

---

### B-4: Force-stop behavior

**Classification**: CONFIRMED

After `Settings → Force Stop`, the app cannot receive broadcasts or run WorkManager until the user manually launches the app again. This is an Android platform behavior.

**Action**: Document as a known limitation. Do not attempt workarounds.

---

## 8. Security Risks

### S-1: Firebase client config in APK

**Classification**: CONFIRMED — acceptable

`google-services.json` is embedded in the APK and can be extracted via reverse engineering. This is expected and documented by Firebase. Security rules are the actual enforcement boundary.

**Action**: Ensure security rules are correctly deployed before any production use.

---

### S-2: No end-to-end encryption

**Classification**: CONFIRMED — documented

File contents are transmitted over TLS but stored unencrypted in Cloud Storage. Firebase admins can access the data.

**Action**: Document as a known limitation. Consider client-side encryption as a future enhancement if needed.

---

### S-3: Room database is unencrypted

**Classification**: CONFIRMED

Room database on the device stores filenames, hashes, paths, and upload status in plaintext. A device with unlocked bootloader or root access could read this data.

**Action**: Consider SQLCipher for sensitive use cases. For a private app on a personal device, unencrypted Room is acceptable.

---

## 9. Missing Decisions

| ID | Decision Needed | Impact |
|---|---|---|
| MD-1 | Zero-byte file upload policy | LOW — should skip upload but record in metadata |
| MD-2 | Maximum single-file upload size limit | MEDIUM — Firebase supports up to 5TB but mobile practical limit is much lower |
| MD-3 | WiFi-only vs any-network upload policy | MEDIUM — large files over cellular could be expensive |
| MD-4 | `MANAGE_EXTERNAL_STORAGE` vs SAF-only | CRITICAL — affects the entire USB access architecture |
| MD-5 | Ghost name reservation cleanup mechanism | HIGH — stale reservations waste filename slots |
| MD-6 | Upload session URI persistence for resumable uploads | MEDIUM — affects large file upload reliability |
| MD-7 | Concurrent multi-device backup support | LOW — architecture supports it but not explicitly decided |
| MD-8 | Database encryption (SQLCipher) | LOW — for private device, unencrypted is acceptable |
| MD-9 | Firestore create-only vs set-with-merge for metadata | MEDIUM — affects idempotency and immutability guarantees |
| MD-10 | Filename sanitization rules for Cloud Storage paths | MEDIUM — some USB filenames contain characters invalid in Cloud Storage paths |
| MD-11 | Cloud Storage path structure (canonical layout) | HIGH — three different structures appear in docs |
| MD-12 | Firestore collection hierarchy (flat vs nested under users/) | HIGH — affects security rules |
| MD-13 | `archive.tar.gz` → `archive.tar(1).gz` extension splitting behavior | LOW — confirm intent |
| MD-14 | Whether to use Cloud Functions for Firestore/Storage consistency | MEDIUM — could solve F-1 but adds backend complexity |
| MD-15 | Notification content and behavior during backup | LOW — required for FGS but UX details unspecified |

---

## 10. Things Requiring Physical Device Testing

| ID | Test | Why |
|---|---|---|
| DT-1 | USB mass storage detection via `USB_DEVICE_ATTACHED` broadcast | Verify broadcast is delivered to manifest-registered receiver on target device |
| DT-2 | USB permission auto-grant via `usb_device_filter.xml` + Activity | Verify whether "always open" option eliminates per-connection permission dialogs |
| DT-3 | SAF access to USB volume content | Verify `ACTION_OPEN_DOCUMENT_TREE` shows USB volume and grants access |
| DT-4 | `StorageVolume.createOpenDocumentTreeIntent()` behavior | Verify this pre-navigates to the USB volume in the picker |
| DT-5 | Direct file path access with `MANAGE_EXTERNAL_STORAGE` | Verify `/storage/XXXX-XXXX/` paths are accessible for USB drives |
| DT-6 | SAF recursive traversal performance | Benchmark `ContentResolver.query()` vs `DocumentFile.listFiles()` on USB |
| DT-7 | `USB_DEVICE_DETACHED` dynamic receiver behavior | Verify detach is received when registered programmatically |
| DT-8 | Volume mount delay after USB attach | Measure time between `USB_DEVICE_ATTACHED` and volume becoming accessible |
| DT-9 | Multiple USB device concurrent connection (USB hub) | Verify multiple devices are detected independently |
| DT-10 | WorkManager execution after device reboot | Verify pending work resumes after reboot on target OEM |
| DT-11 | BOOT_COMPLETED delivery on target device | Verify receiver fires after reboot, especially on OEMs with battery optimization |
| DT-12 | Foreground service behavior on Android 15+ | Verify dataSync FGS runs correctly, test 6-hour timeout boundary |
| DT-13 | USB drive with 10,000+ files | Verify scan/hash/upload pipeline handles large file counts |
| DT-14 | Large file (>1GB) upload from USB via SAF | Verify streaming upload works without OOM |
| DT-15 | USB removal during active file read | Verify IOException is caught and recovery state is correct |
| DT-16 | Network loss during upload | Verify WorkManager retry behavior and upload resume |
| DT-17 | Process death during upload | Verify Room state allows correct recovery |
| DT-18 | FAT32 vs exFAT USB drives | Verify both filesystem types are accessible |
| DT-19 | Unicode filenames on USB drive | Verify scanning and metadata preservation |
| DT-20 | USB drive with deeply nested directories (10+ levels) | Verify recursive traversal handles deep nesting |

---

## 11. Recommended Changes

### RC-1: Update Firebase dependency references [HIGH]
Remove `-ktx` suffixes from all Firebase dependency names. Use:
```text
firebase-auth (not firebase-auth-ktx)
firebase-storage (not firebase-storage-ktx)
firebase-firestore (not firebase-firestore-ktx)
```
**Files**: BUILD_AND_TOOLCHAIN.md, ANDROID_APIS.md, PUBLIC_APIS.md

### RC-2: Resolve Firestore collection hierarchy [HIGH]
Choose between flat top-level collections or subcollections under `users/{uid}`. Update CLOUD_BACKEND.md and SECURITY.md to be consistent.

**Recommendation**: Use subcollections under `users/{uid}` for simpler security rules:
```text
users/{uid}/sources/{sourceId}
users/{uid}/files/{fileId}
users/{uid}/contentHashes/{sha256}
users/{uid}/backupJobs/{jobId}
```

### RC-3: Resolve Cloud Storage path structure [HIGH]
Settle on one canonical path structure. Update CLOUD_BACKEND.md, REQUIREMENTS.md, and ARCHITECTURE.md.

**Recommendation**:
```text
backups/{uid}/{sourceId}/{relativePath}/filename.ext
```

### RC-4: Decide USB storage access strategy [CRITICAL]
Choose between `MANAGE_EXTERNAL_STORAGE` and SAF-only. This is the single most impactful architectural decision remaining.

**Recommendation**: Use `MANAGE_EXTERNAL_STORAGE` for the private sideloaded app, with SAF as a documented fallback.

### RC-5: Add upload session URI persistence to data model [MEDIUM]
Add a `sessionUri` field to `UploadTaskEntity` for Firebase upload resume support after process death.

### RC-6: Add ghost reservation cleanup mechanism [HIGH]
Define a policy for cleaning up Firestore name reservations with `status: pending` that are older than a threshold (e.g., 24 hours).

### RC-7: Resolve the Cloud Storage/Firestore consistency TODO [HIGH]
Store SHA-256 as custom metadata on Cloud Storage objects. On recovery, check object metadata before re-uploading or re-indexing.

### RC-8: Add `ACCESS_NETWORK_STATE` to permissions [LOW]
PERMISSIONS.md lists it as "may also require" but the actual manifest declaration is not shown. WorkManager network constraints may need it.

### RC-9: Document OEM battery optimization workaround guidance [MEDIUM]
Add a section to PERMISSIONS.md or a new DEVICE_COMPATIBILITY.md with guidance for whitelisting the app on common OEMs.

### RC-10: Add concurrent multi-device backup decision [LOW]
Document whether simultaneous backup of multiple USB devices is supported. The architecture supports it via unique work names.

### RC-11: Verify and document Android 16 behavior [LOW]
README.md targets API 36 (Android 16). Verify there are no new restrictions that affect the architecture. BUILD_AND_TOOLCHAIN.md says `compileSdk = 36, targetSdk = 36`.

---

## 12. Questions That Must Be Resolved Before Implementation

### Q-1: USB storage access method [BLOCKER]

> Should the app use `MANAGE_EXTERNAL_STORAGE` (direct file access, faster, no per-volume interaction) or SAF-only (standards-compliant, slower, requires user interaction per volume)?

For a private sideloaded app, `MANAGE_EXTERNAL_STORAGE` is practical and avoids the user-interaction problem. But if Play Store distribution is ever considered, SAF is required. This decision affects the entire storage access layer.

### Q-2: Firestore collection hierarchy [BLOCKER]

> Should Firestore collections be flat (top-level) or nested under `users/{uid}`?

This affects security rules, query patterns, and the entire cloud data architecture.

### Q-3: Cloud Storage path structure [BLOCKER]

> What is the canonical Cloud Storage object path?

Three different structures appear in the documentation. This must be resolved before implementation.

### Q-4: How to handle USB permission for zero-interaction operation? [IMPORTANT]

> Can the `usb_device_filter.xml` + Activity auto-launch approach provide truly automatic permission, or will the user see a dialog each time?

This requires physical device testing (DT-2).

### Q-5: Ghost reservation cleanup [IMPORTANT]

> What is the mechanism and timing for cleaning up Firestore name reservations that were created but never followed by a successful upload?

Options: periodic Cloud Function, on-startup cleanup query, or TTL-based document expiration.

### Q-6: Maximum file size limit [IMPORTANT]

> Should there be a per-file upload size limit? If so, what?

Firebase supports very large files, but mobile uploads over cellular have practical limits. Consider a configurable threshold (e.g., 2GB default, adjustable).

### Q-7: WiFi-only upload option [IMPORTANT]

> Should the app default to WiFi-only uploads, or allow any network?

WorkManager supports `NetworkType.UNMETERED` constraint for WiFi-only. This should be a setup-time preference.

---

## Summary Assessment

### Strengths
- The documentation is remarkably thorough and well-structured.
- The architecture is fundamentally sound: event-driven, crash-resilient, content-based dedup.
- The state machine is well-designed with appropriate states for crash recovery.
- The security model correctly identifies Firebase rules as the enforcement boundary.
- The testing strategy is comprehensive and realistic.

### Weaknesses
- USB storage access strategy is unresolved — this is the single biggest risk.
- Firestore collection structure is inconsistent across documents.
- Cloud Storage path structure has three different versions.
- Firebase KTX dependency references are outdated.
- Several TODOs remain unresolved in the documentation.
- No explicit mechanism for Cloud Storage/Firestore consistency recovery.

### Implementation Readiness

```
NOT READY — BLOCKERS EXIST
```

**Blockers**:
1. **Q-1**: USB storage access method (MANAGE_EXTERNAL_STORAGE vs SAF) must be decided.
2. **Q-2**: Firestore collection hierarchy must be resolved and made consistent.
3. **Q-3**: Cloud Storage path structure must be resolved and made consistent.
4. **RC-1**: Firebase dependency references must be updated (KTX removal).
5. **RC-7**: Cloud Storage/Firestore consistency recovery mechanism must be defined.

Once these 5 blockers are resolved, the project will be ready for Phase 0 implementation.
