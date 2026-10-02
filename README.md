# USBCloudBackup

## Overview

USBCloudBackup is a native Android application that automatically detects USB storage devices, scans their contents, and backs up files to Firebase Cloud Storage with content-based deduplication and automatic filename versioning.

## Purpose

Many users store important files on USB drives but rarely create cloud backups. This app removes all friction from the backup process.

The user installs the app once, completes first-run setup once, and never needs to manually open the app again. Whenever a USB drive is attached:

1. App detects the USB device via `UsbManager` and `BroadcastReceiver`.
2. App discovers storage volume via hybrid storage access (SAF / `MANAGE_EXTERNAL_STORAGE`).
3. WorkManager enqueues a background job chain.
4. Files are scanned recursively and SHA-256 hashes are computed.
5. Files already backed up are skipped (content-based deduplication).
6. New files are uploaded to Firebase Cloud Storage.
7. Filename collisions produce automatic versioned names (`name(1).ext`, `name(2).ext`) reserved transactionally in Firestore.
8. Operation details are indexed in Firestore and local Room DB for crash recovery.

## Target Platform & Baseline

- **Minimum SDK**: Android 10 (API 29)
- **Target SDK**: Android 16 (API 36)
- **Compile SDK**: Android 16 (API 36)
- **Language**: Kotlin
- **Jetpack Libraries**: Room 2.6+, WorkManager 2.9+, Lifecycle
- **Firebase Platform**: BoM 34.17.0 (`firebase-auth`, `firebase-storage`, `firebase-firestore`)

## Key Design Principles

1. **Zero-interaction backup** — Headless operation after first-run setup.
2. **Content-based deduplication** — SHA-256 identity, not filename identity.
3. **Never overwrite** — Existing cloud files are never replaced.
4. **Automatic versioning** — Filename collisions produce `(1)`, `(2)`, `(3)` suffixes.
5. **Crash-safe** — Multi-stage state machine with upload session resume and cloud reconciliation.
6. **Event-driven** — No polling, no permanent idle service.

## Documentation Set

Master Architecture Specification:
- **[FINAL_IMPLEMENTATION_SPEC.md](FINAL_IMPLEMENTATION_SPEC.md)** — Master Blueprint

Detailed Architectural Specifications:
- [USB_ACCESS_DECISION.md](USB_ACCESS_DECISION.md) — Hybrid Storage Access Strategy
- [FIRESTORE_SCHEMA.md](FIRESTORE_SCHEMA.md) — Firestore Database Hierarchy & Rules
- [CLOUD_STORAGE_SCHEMA.md](CLOUD_STORAGE_SCHEMA.md) — Cloud Storage Paths & Metadata
- [FIREBASE_DEPENDENCIES.md](FIREBASE_DEPENDENCIES.md) — Firebase Dependency Setup
- [CLOUD_CONSISTENCY.md](CLOUD_CONSISTENCY.md) — Crash Recovery & Upload Lifecycle
- [NAME_RESERVATION.md](NAME_RESERVATION.md) — Atomic Filename Reservation Protocol
- [INVARIANTS.md](INVARIANTS.md) — System Invariants (I-001 to I-014)
- [DEVICE_VALIDATION_PLAN.md](DEVICE_VALIDATION_PLAN.md) — 50-Test Physical Validation Matrix
- [CONTEXT_AUDIT.md](CONTEXT_AUDIT.md) — Initial Audit & Finding Analysis
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — Sequential Phase Execution Plan

Original Reference Specs:
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [REQUIREMENTS.md](REQUIREMENTS.md)
- [ANDROID_APIS.md](ANDROID_APIS.md)
- [USB_STORAGE.md](USB_STORAGE.md)
- [FILE_DISCOVERY.md](FILE_DISCOVERY.md)
- [HASHING_AND_DEDUPLICATION.md](HASHING_AND_DEDUPLICATION.md)
- [VERSIONING_AND_NAMING.md](VERSIONING_AND_NAMING.md)
- [CLOUD_BACKEND.md](CLOUD_BACKEND.md)
- [BACKGROUND_EXECUTION.md](BACKGROUND_EXECUTION.md)
- [PERMISSIONS.md](PERMISSIONS.md)
- [DATA_MODEL.md](DATA_MODEL.md)
- [STATE_MACHINE.md](STATE_MACHINE.md)
- [ERROR_HANDLING.md](ERROR_HANDLING.md)
- [SECURITY.md](SECURITY.md)
- [OFFLINE_AND_RETRY.md](OFFLINE_AND_RETRY.md)
- [TESTING.md](TESTING.md)
- [BUILD_AND_TOOLCHAIN.md](BUILD_AND_TOOLCHAIN.md)
- [PUBLIC_APIS.md](PUBLIC_APIS.md)
- [AGENT_RULES.md](AGENT_RULES.md)
- [DECISIONS.md](DECISIONS.md)
- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
