# USBCloudBackup — Master Implementation Plan

> **Version**: 5.0.0 (Backblaze B2 Storage & Smart Backup Policy Implementation)  
> **Target Platform**: Android 7.0 (API 24) to Android 16 (API 36), Kotlin, Jetpack, Firebase, Backblaze B2  
> **Status**: IN PROGRESS — (Phases 0–8 Software Complete; Phase 9 Pending Physical Hardware)

---

## Architecture Overview

USBCloudBackup is a native Android background service application designed for automated, zero-interaction file backup from attached USB mass storage devices to Backblaze B2 binary storage coordinated by Firebase Auth and Cloud Firestore metadata.

```text
USB Attach Broadcast
       │
       ▼
UsbEventReceiver (Class 8 Mass Storage Filter)
       │
       ▼
BackupWorkManager.enqueueBackup() (ExistingWorkPolicy.KEEP, Unique Work 'backup_{sourceId}')
       │
       ▼
BackupWorker (Promoted to dataSync Foreground Service)
       │
       ├─► 1. Ensure Auth & Profile (FirebaseAuthRepository, FirestoreRepository)
       ├─► 2. Obtain Storage Source (DirectFileStorageSource / SafStorageSource)
       ├─► 3. File Discovery (FileScanner ──► Room DISCOVERED)
       ├─► 4. Smart Backup Policy (BackupPolicyEngine: Category B ──► Room METADATA_INDEXED)
       ├─► 5. Streaming SHA-256 (Sha256Calculator ──► Room HASHED)
       ├─► 6. Content Deduplication (DeduplicationEngine & Firestore contentHashes ──► Room SKIPPED_DUPLICATE)
       ├─► 7. Transactional Name Reservation (VersionedNameResolver ──► Room NAME_RESERVED)
       ├─► 8. Backblaze B2 Stream Upload (CloudRecoveryEngine / BackblazeB2StorageRepository ──► Room UPLOADED_NOT_INDEXED)
       └─► 9. Atomic Firestore Index Finalization (files + contentHashes + COMMITTED ──► Room INDEXED)
```

---

## Phase 0: Project Setup & Gradle Bootstrap

### Goal
Initialize Android project structure, Gradle build setup, version catalog, dependencies, permissions, and package hierarchy.

### Status
**COMPLETE** (Verified via clean build and test execution)

### Files Created & Configured
- `settings.gradle.kts`
- `build.gradle.kts` (Root)
- `app/build.gradle.kts`
- `gradle/libs.versions.toml`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/res/xml/usb_device_filter.xml`
- `app/src/main/res/values/strings.xml`, `themes.xml`
- `USBCloudBackupApplication.kt`

### Dependencies (`libs.versions.toml`)
- Firebase BoM `34.17.0` (`firebase-auth`, `firebase-storage`, `firebase-firestore` — base artifacts without deprecated `-ktx` suffixes)
- AndroidX Core KTX, Lifecycle Runtime, WorkManager `2.9.1`, Room `2.6.1`, KSP Plugin
- Robolectric 4.12.2, JUnit 4, Kotlinx Coroutines Test

### Manifest Declarations
- Permissions: `INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `MANAGE_EXTERNAL_STORAGE`, `POST_NOTIFICATIONS`
- Hardware Feature: `android.hardware.usb.host` (required)
- Services: Merged `androidx.work.impl.foreground.SystemForegroundService` with `foregroundServiceType="dataSync"`

---

## Phase 1: First-Run Setup & Authentication

### Goal
Build minimal setup Activity for one-time initialization, permission granting, storage capability check, and Firebase authentication.

### Status
**PARTIALLY COMPLETE** (Firebase Auth repository complete; interactive Activity permission dispatch pending)

### Files
- `app/src/main/java/com/usbcloudbackup/setup/MainActivity.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/auth/AuthRepository.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/auth/FirebaseAuthRepository.kt`

### Implementation Logic
1. `MainActivity` checks `setup_complete` in SharedPreferences. If true, finishes immediately.
2. `FirebaseAuthRepository` signs in anonymously if no `currentUser` exists.
3. Requests `POST_NOTIFICATIONS` permission (Android 13+).
4. Checks `Environment.isExternalStorageManager()`. If false, navigates user to `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`.
5. Tests storage accessibility and sets `direct_file_mode` in SharedPreferences.
6. Sets `setup_complete = true` and finishes cleanly.

### Tests
- `RepositoryTest.kt` (Auth state handling)
- Future: Robolectric test for `MainActivity` lifecycle and SharedPreferences transitions.

---

## Phase 2: Room Local Database Layer

### Goal
Define local durable data store for tracking backup jobs, source devices, files, upload tasks, and name reservations.

### Status
**COMPLETE** (5 Entities, 5 DAOs, 5 Repositories, Type Converters fully implemented and verified)

### Files
- `app/src/main/java/com/usbcloudbackup/database/AppDatabase.kt`
- `app/src/main/java/com/usbcloudbackup/database/entity/SourceEntity.kt`
- `app/src/main/java/com/usbcloudbackup/database/entity/BackupJobEntity.kt`
- `app/src/main/java/com/usbcloudbackup/database/entity/FileEntity.kt`
- `app/src/main/java/com/usbcloudbackup/database/entity/UploadTaskEntity.kt`
- `app/src/main/java/com/usbcloudbackup/database/entity/NameReservationEntity.kt`
- `app/src/main/java/com/usbcloudbackup/database/dao/*` (5 DAOs)
- `app/src/main/java/com/usbcloudbackup/backup/repository/*` (5 Repositories)
- `app/src/main/java/com/usbcloudbackup/database/converter/*` (Type Converters)

### Tests
- `RoomDatabaseTest.kt`
- `RepositoryTest.kt`
- `StateMachineTest.kt`

---

## Phase 3: USB Detection & Storage Access Layer

### Goal
Detect USB attachment and abstract physical storage access (hybrid SAF / `MANAGE_EXTERNAL_STORAGE`).

### Status
**PARTIALLY COMPLETE** (USB attach broadcast receiver and direct file storage access complete; SAF Storage Source pending)

### Files
- `app/src/main/java/com/usbcloudbackup/receivers/UsbEventReceiver.kt` (Complete)
- `app/src/main/java/com/usbcloudbackup/storage/UsbStorageSource.kt` (Interface complete)
- `app/src/main/java/com/usbcloudbackup/storage/DirectFileStorageSource.kt` (Complete)
- `app/src/main/java/com/usbcloudbackup/storage/FakeStorageSource.kt` (Complete)
- `app/src/main/java/com/usbcloudbackup/storage/DiscoveredFileDescriptor.kt` (Complete)
- `app/src/main/java/com/usbcloudbackup/storage/SafStorageSource.kt` (Pending implementation)

### Implementation Logic
- `UsbEventReceiver` catches `ACTION_USB_DEVICE_ATTACHED`, filters for USB Class 8 (Mass Storage), generates stable source fingerprint (`vendorId-productId-serialOrHash`), and enqueues `BackupWorkManager.enqueueBackup()`.
- `DirectFileStorageSource` reads USB files via `java.io.File` / `FileInputStream`.
- `SafStorageSource` will read USB files via `DocumentsContract.buildChildDocumentsUri()` and `ContentResolver.openInputStream()` for devices where direct file access is restricted.

### Tests
- `UsbEventReceiverTest.kt`
- `UsbDisconnectSafetyTest.kt`

---

## Phase 4: Scanning & SHA-256 Hashing Engine

### Goal
Recursively scan attached USB directories and calculate streaming SHA-256 hashes with zero full-file RAM buffering.

### Status
**COMPLETE** (Integrated into `BackupWorker` sequential execution pipeline)

### Files
- `app/src/main/java/com/usbcloudbackup/scanning/FileScanner.kt`
- `app/src/main/java/com/usbcloudbackup/hashing/Sha256Calculator.kt`
- `app/src/main/java/com/usbcloudbackup/worker/BackupWorker.kt` (Stages 4 & 5)

### Implementation Logic
- `FileScanner` recursively discovers files, filtering out system folders (`System Volume Information`, `$RECYCLE.BIN`, `.Trashes`, hidden `.` files), batch-inserting `FileEntity` with status `DISCOVERED`.
- `Sha256Calculator` streams bytes through a 64 KB buffer into `MessageDigest.getInstance("SHA-256")`, returning 64-char lowercase hex string. Updates Room status to `HASHED`.

### Tests
- `FileScannerTest.kt`
- `Sha256CalculatorTest.kt`
- `FullLocalPipelineTest.kt`

---

## Phase 5: Deduplication & Versioned Name Reservation Engine

### Goal
Check Firestore for duplicate content hashes and transactionally reserve versioned filenames (`name(N).ext`) with 24h TTL.

### Status
**COMPLETE** (Integrated into `BackupWorker` sequential execution pipeline)

### Files
- `app/src/main/java/com/usbcloudbackup/backup/DeduplicationEngine.kt`
- `app/src/main/java/com/usbcloudbackup/backup/VersionedNameResolver.kt`
- `app/src/main/java/com/usbcloudbackup/util/ReservationUtils.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/firestore/FirebaseFirestoreRepository.kt`

### Implementation Logic
- Local Room deduplication and Firestore `users/{uid}/contentHashes/{sha256}` lookup mark duplicate files as `SKIPPED_DUPLICATE`.
- New content runs `VersionedNameResolver` and Firestore transaction on `users/{uid}/nameReservations/{resId}`.
- Handles filename versioning `basename(N).ext`, multi-dot files (`archive.tar(1).gz`), and 24h TTL reservation reclamation.

### Tests
- `DeduplicationEngineTest.kt`
- `VersionedNameResolverTest.kt`
- `ReservationUtilsTest.kt`
- `ReservationResilienceTest.kt`

---

## Phase 6: Backblaze B2 Storage & Smart Backup Policy Layer

### Goal
Stream binary file bytes to Backblaze B2 via AWS SigV4 Presigned URLs with S3 custom metadata, enforce the dual-mode Smart Backup Policy (Category A automatic upload vs Category B metadata-only index), fulfill on-demand backup requests, and execute atomic Firestore indexing.

### Status
**COMPLETE** (BackblazeB2StorageRepository, scoped B2AuthorizationProvider, B2KeyFormatter, BackupPolicyEngine, CloudRecoveryEngine, backend/b2-authorizer, and comprehensive tests verified)

### Files
- `app/src/main/java/com/usbcloudbackup/cloud/storage/b2/BackblazeB2StorageRepository.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/storage/b2/B2Authorization.kt`
- `app/src/main/java/com/usbcloudbackup/util/B2KeyFormatter.kt`
- `app/src/main/java/com/usbcloudbackup/policy/BackupPolicy.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/storage/CloudStorageRepository.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/firestore/FirestoreRepository.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/firestore/FirebaseFirestoreRepository.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/recovery/CloudRecoveryEngine.kt`
- `backend/b2-authorizer/`
- `BACKUP_POLICY.md`
- `B2_STORAGE_SCHEMA.md`
- `B2_SECURITY.md`

### Implementation Logic
- Streaming byte upload directly to canonical B2 path: `backups/{uid}/{sourceId}/{relativePath}{storedName}` with metadata `x-amz-meta-sha256`.
- Zero long-lived Backblaze API secrets compiled into the Android APK (scoped authorization via `B2AuthorizationProvider`).
- Automatic extension classification (Category A: documents, images, audio, archives; Category B: metadata-only indexing).
- On-demand backup request fulfillment upon USB re-attachment, computing hash of CURRENT bytes.
- Advances Room state to `UPLOADED_NOT_INDEXED`.
- Atomic Firestore finalization transaction writes `files`, `contentHashes`, updates reservation status to `COMMITTED`, and increments job counters. Advances Room state to `INDEXED`.
- Invariant I-015: Byte-for-byte fidelity verified without compression, transcoding, or alteration.

### Tests
- `B2KeyFormatterTest.kt`
- `BackblazeB2StorageRepositoryTest.kt`
- `B2PresignedUploadTest.kt`
- `B2MetadataTest.kt`
- `B2RecoveryTest.kt`
- `B2ByteFidelityTest.kt`
- `B2SecurityTest.kt`
- `B2MultipartTest.kt`
- `BackupPolicyTest.kt`
- `BackupRequestFulfillmentTest.kt`
- `ByteFidelityTest.kt`
- `FullCloudPipelineIntegrationTest.kt`
- `CloudRecoveryEngineTest.kt`
- `FirebaseErrorClassifierTest.kt`
- `AmbiguousUploadRecoveryTest.kt`

---

## Phase 7: WorkManager Pipeline & Foreground Service Integration

### Goal
Wire background execution into a cohesive, crash-safe WorkManager pipeline with foreground promotion (`dataSync` FGS).

### Status
**COMPLETE** (Unified `BackupWorker` with foreground promotion and `BackupWorkManager` orchestration)

### Files
- `app/src/main/java/com/usbcloudbackup/worker/BackupWorkManager.kt`
- `app/src/main/java/com/usbcloudbackup/worker/BackupWorker.kt`
- `app/src/main/AndroidManifest.xml`

### Implementation Logic
- `BackupWorkManager` enqueues unique work with `ExistingWorkPolicy.KEEP` tagged `backup_{sourceId}`.
- `BackupWorker` executes the complete pipeline end-to-end as a `CoroutineWorker`.
- `BackupWorker.promoteToForegroundIfPossible()` promotes worker to foreground service (`FOREGROUND_SERVICE_TYPE_DATA_SYNC`) on Android 14+ (API 34/35/36).
- Supports clean coroutine cancellation by catching and rethrowing `CancellationException`.

### Tests
- `BackupWorkerTest.kt`
- `LocalPipelineIntegrationTest.kt`

---

## Phase 8: Crash Recovery & Reconciliation Engine

### Goal
Implement automated recovery for interrupted uploads, un-indexed objects, and stale reservations across process kills and reboots.

### Status
**COMPLETE** (`ReconciliationWorker`, `BootReceiver`, `CloudRecoveryEngine`, and `RESILIENCE_MATRIX.md` complete)

### Files
- `app/src/main/java/com/usbcloudbackup/worker/ReconciliationWorker.kt`
- `app/src/main/java/com/usbcloudbackup/receivers/BootReceiver.kt`
- `app/src/main/java/com/usbcloudbackup/cloud/recovery/CloudRecoveryEngine.kt`
- `RESILIENCE_MATRIX.md`

### Implementation Logic
- `BootReceiver` enqueues `ReconciliationWorker` upon `ACTION_BOOT_COMPLETED`.
- `ReconciliationWorker` finds tasks in `UPLOADED_NOT_INDEXED` state and completes Firestore metadata finalization without byte re-upload.
- `CloudRecoveryEngine.processOrRecoverUpload()` inspects Cloud Storage via `checkObjectExists()` and validates `x-custom-sha256` before re-uploading bytes, preventing duplicate version generation.
- Full verification of all 14 system invariants (`I-001` through `I-014`).

### Tests
- `ReconciliationWorkerTest.kt`
- `ProcessDeathRecoveryTest.kt`
- `AmbiguousUploadRecoveryTest.kt`
- `ReservationResilienceTest.kt`
- `UsbDisconnectSafetyTest.kt`
- `InvariantCoverageTest.kt`

---

## Phase 9: End-to-End Validation & Polish

### Goal
Execute the complete physical device validation suite (50 tests in `DEVICE_VALIDATION_PLAN.md`), verify real Firebase project integration, and validate release hardening.

### Status
**NOT STARTED / PENDING PHYSICAL HARDWARE** (Specification matrix complete; execution pending physical phone + USB hardware)

### Required Test Matrix (`DEVICE_VALIDATION_PLAN.md`)
1. **Category 1: USB Hardware Detection (DV-01 to DV-07)**: Attach broadcasts, disconnect detection, boot reconciliation with plugged USB, multi-device hubs, non-storage device filtering.
2. **Category 2: Storage Access (DV-08 to DV-12)**: `MANAGE_EXTERNAL_STORAGE` direct file access, SAF document picker root selection, persistent URI reboot survival, volume mount timing.
3. **Category 3: File Operations (DV-13 to DV-24)**: 10,000+ files scan, deeply nested directories, Unicode/special characters, 1GB and 4GB+ streaming SHA-256, FAT32 vs exFAT filesystem compatibility.
4. **Category 4: Upload and Cloud (DV-25 to DV-31)**: Small and 500MB+ file uploads, content deduplication, version naming `name(1).ext` and `name(2).ext`.
5. **Category 5: Interruption and Recovery (DV-32 to DV-42)**: USB disconnect during scan/hash/upload, network drops, process kills, reboot during upload, force-stop, app data clearance.
6. **Category 6: OEM-Specific (DV-43 to DV-50)**: Battery optimization bypass, aggressive OEM kill resistance (Samsung, Xiaomi, Pixel), lock screen execution.

### Prerequisites for Physical Execution
1. Physical Android phone (API 34+) with USB OTG adapter and test flash drives (FAT32 & exFAT).
2. Active Firebase project configuration (replacing placeholder `google-services.json`).
3. Deployed `firestore.rules` and `storage.rules`.
