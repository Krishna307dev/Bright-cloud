# USBCloudBackup — Implementation Status Report

> **Generated**: 2026-08-22  
> **Source Verification**: Codebase, Room DB, WorkManager Orchestration, Backblaze B2 Storage Layer, Smart Backup Policy, Unit & Resilience Test Suite  
> **Classification Framework**: `COMPLETE` | `PARTIALLY COMPLETE` | `NOT STARTED` | `SUPERSEDED BY LATER IMPLEMENTATION`

---

## Executive Summary

A comprehensive documentation-to-code audit of the USBCloudBackup repository was conducted against the documented phases (0 through 9) in `IMPLEMENTATION_PLAN.md`, `FINAL_IMPLEMENTATION_SPEC.md`, `AGENT_RULES.md`, the actual Kotlin source tree, and the automated test suite.

The cloud storage backend has been migrated to **Backblaze B2** (`BackblazeB2StorageRepository`, bucket `BrightCloud` at `https://s3.eu-central-003.backblazeb2.com`), with scoped AWS SigV4 Presigned URL authorizations (`B2AuthorizationProvider`, `backend/b2-authorizer/`) to guarantee zero root credentials in the Android APK. The dual-mode **Smart Backup Policy** (`BackupPolicyEngine`) automatically classifies files into Category A (automatic streaming upload) and Category B (metadata-only indexing with on-demand cloud backup fulfillment). All unit and resilience tests pass cleanly across Android API 24 through API 36.

---

## Phase-by-Phase Audit Matrix

| Phase | Title | Documented Goal | Status | Key Source Files | Key Tests |
|---|---|---|---|---|---|
| **Phase 0** | Project Setup & Gradle Bootstrap | Initialize Android project structure, Gradle build, version catalog, dependencies, permissions, and package hierarchy (minSdk=24, compileSdk=36). | **COMPLETE** | `build.gradle.kts`, `app/build.gradle.kts`, `gradle/libs.versions.toml`, `AndroidManifest.xml` | Build verification (`clean assembleDebug`, `clean test`) |
| **Phase 1** | First-Run Setup & Authentication | Build minimal setup Activity for one-time initialization, permission requests, and Firebase authentication. | **COMPLETE** | `MainActivity.kt`, `activity_main.xml`, `cloud/auth/FirebaseAuthRepository.kt`, `cloud/auth/AuthRepository.kt` | `MainActivityTest.kt`, `RepositoryTest.kt` |
| **Phase 2** | Room Local Database Layer | Define local durable data store for tracking backup jobs, source devices, files, upload tasks, and name reservations. | **COMPLETE** | `AppDatabase.kt`, 5 Entities (`SourceEntity`, `BackupJobEntity`, `FileEntity`, `UploadTaskEntity`, `NameReservationEntity`), 5 DAOs, 5 Repositories, Type Converters | `RoomDatabaseTest.kt`, `RepositoryTest.kt`, `StateMachineTest.kt` |
| **Phase 3** | USB Detection & Storage Access Layer | Detect USB attachment and abstract physical storage access (hybrid SAF / `MANAGE_EXTERNAL_STORAGE`). | **COMPLETE** | `UsbEventReceiver.kt`, `DirectFileStorageSource.kt`, `SafStorageSource.kt`, `StorageSourceFactory.kt`, `UsbStorageSource.kt`, `DiscoveredFileDescriptor.kt` | `UsbEventReceiverTest.kt`, `SafStorageSourceTest.kt`, `UsbDisconnectSafetyTest.kt` |
| **Phase 4** | Scanning & SHA-256 Hashing Engine | Recursively scan attached USB directories and calculate streaming SHA-256 hashes with zero full-file RAM buffering. | **COMPLETE** | `FileScanner.kt`, `Sha256Calculator.kt`, integrated into `BackupWorker.kt` (Stages 4 & 5) | `FileScannerTest.kt`, `Sha256CalculatorTest.kt`, `FullLocalPipelineTest.kt` |
| **Phase 5** | Deduplication & Versioned Name Reservation Engine | Check Firestore for duplicate content hashes and transactionally reserve versioned filenames (`name(N).ext`) with 24h TTL. | **COMPLETE** | `DeduplicationEngine.kt`, `VersionedNameResolver.kt`, `ReservationUtils.kt`, `FirebaseFirestoreRepository.kt`, integrated into `BackupWorker.kt` (Stages 6 & 7) | `DeduplicationEngineTest.kt`, `VersionedNameResolverTest.kt`, `ReservationUtilsTest.kt`, `ReservationResilienceTest.kt` |
| **Phase 6** | Backblaze B2 Storage & Smart Backup Policy Layer | Stream bytes directly to Backblaze B2 via AWS SigV4 Presigned URLs, implement Smart Backup Policy, and execute atomic Firestore indexing. | **COMPLETE** | `BackblazeB2StorageRepository.kt`, `B2Authorization.kt`, `B2KeyFormatter.kt`, `BackupPolicy.kt`, `FirebaseFirestoreRepository.kt`, `CloudRecoveryEngine.kt`, `backend/b2-authorizer/` | `BackblazeB2StorageRepositoryTest.kt`, `B2PresignedUploadTest.kt`, `B2KeyFormatterTest.kt`, `B2MetadataTest.kt`, `B2RecoveryTest.kt`, `B2ByteFidelityTest.kt`, `B2SecurityTest.kt`, `B2MultipartTest.kt` |
| **Phase 7** | WorkManager Pipeline & Foreground Service Integration | Wire pipeline into cohesive, crash-safe WorkManager execution with foreground promotion (`dataSync` FGS). | **COMPLETE** | `BackupWorkManager.kt`, `BackupWorker.kt` (`promoteToForegroundIfPossible()`), `AndroidManifest.xml` (`SystemForegroundService`) | `BackupWorkerTest.kt`, `LocalPipelineIntegrationTest.kt` |
| **Phase 8** | Crash Recovery & Reconciliation Engine | Implement automated recovery for interrupted uploads, un-indexed objects, and stale reservations with zero-byte re-upload. | **COMPLETE** | `ReconciliationWorker.kt`, `BootReceiver.kt`, `CloudRecoveryEngine.kt`, `RESILIENCE_MATRIX.md` | `ReconciliationWorkerTest.kt`, `ProcessDeathRecoveryTest.kt`, `AmbiguousUploadRecoveryTest.kt`, `InvariantCoverageTest.kt` |
| **Phase 9** | End-to-End Validation & Polish | Execute physical device validation suite (50 tests in `DEVICE_VALIDATION_PLAN.md`) and verify release hardening. | **PENDING PHYSICAL HARDWARE** | `DEVICE_VALIDATION_PLAN.md`, `INVARIANTS.md`, Proguard configuration | Pending physical phone + USB hardware availability |

---

## Detailed Component Summary

### 1. Backblaze B2 Storage & Authorization
- `BackblazeB2StorageRepository`: Implements `CloudStorageRepository` using streaming HTTP `PUT` / S3 `PutObject` and `HEAD` / S3 `HeadObject` with zero full-file RAM buffering.
- `B2AuthorizationProvider` & `backend/b2-authorizer/`: Scoped authorization protocol ensuring zero Backblaze master credentials in the Android APK.
- `B2KeyFormatter`: Deterministic path construction and sanitization under `backups/{uid}/{sourceId}/{relativePath}{storedName}`.

### 2. Smart Backup Policy & On-Demand Backup
- `BackupPolicyEngine`: Classifies files into Category A (`AUTOMATIC`) and Category B (`METADATA_ONLY`).
- On-Demand Requests: When a user requests backup of a Category B file on the Web Viewer, the Android agent detects the request (`requestStatus == "REQUESTED"`), hashes CURRENT physical USB bytes, and fulfills the upload upon USB attachment.

### 3. Byte-for-Byte Fidelity
- Invariant I-015: 100% byte fidelity verified across PDF, PNG, JPEG, DOCX, MP3, and ZIP fixtures.
