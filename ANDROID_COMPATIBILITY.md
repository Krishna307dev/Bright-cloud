# Android Compatibility Specification

## Overview

USBCloudBackup is engineered to provide seamless, crash-resilient USB flash drive cloud backup across the entire Android platform spectrum from **Android 7.0 (API Level 24)** through **Android 16 (API Level 36)**.

| Parameter | Configuration |
|---|---|
| **`minSdk`** | `24` (Android 7.0 Nougat) |
| **`targetSdk`** | `36` (Android 16) |
| **`compileSdk`** | `36` (Android 16) |
| **Java / Kotlin Compatibility** | Java 17 toolchain with D8 desugaring |

---

## 1. Storage Access Strategy Across Android Versions

| API Tier | Android Versions | Primary Storage Strategy | Implementation Details |
|---|---|---|---|
| **API 24 – 29** | Android 7.0 – 10.0 | **Storage Access Framework (SAF)** (`SafStorageSource`) | Removable USB volumes accessed via standard Storage Access Framework `DocumentsContract` tree URIs. Persistent URI permissions granted via `ContentResolver.takePersistableUriPermission()` survive system reboots. Direct `/storage/{uuid}` path access is not supported by AOSP without SAF permissions. |
| **API 30+** | Android 11.0 – 16.0 | **Hybrid Direct File (`DirectFileStorageSource`) / SAF (`SafStorageSource`)** | If `MANAGE_EXTERNAL_STORAGE` is granted via `Environment.isExternalStorageManager()`, direct high-speed `java.io.File` traversal on `/storage/{uuid}` is used. If not granted or OEM restricts direct file I/O, seamlessly falls back to SAF with zero pipeline redesign. |

### Storage Abstraction Architecture
The core business pipeline (`FileScanner`, `Sha256Calculator`, `DeduplicationEngine`, `VersionedNameResolver`, `CloudRecoveryEngine`) operates strictly against the uniform `UsbStorageSource` interface and `DiscoveredFileDescriptor` streams. It is entirely agnostic of the underlying storage mechanism.

```text
UsbStorageSource
  ├── DirectFileStorageSource (API 30+ with MANAGE_EXTERNAL_STORAGE)
  ├── SafStorageSource (API 24+ standard SAF tree traversal)
  └── FakeStorageSource (Robolectric and JVM unit testing)
```

---

## 2. Platform Differences Matrix

### A. Runtime Permissions
- **`POST_NOTIFICATIONS`**:
  - **API 33+ (Android 13+)**: Runtime permission requested during one-time setup via `ActivityCompat.requestPermissions`.
  - **API 24 – 32**: Granted automatically at install time; no runtime permission dialog shown.
- **`MANAGE_EXTERNAL_STORAGE`**:
  - **API 30+ (Android 11+)**: Special app access managed via `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`.
  - **API 24 – 29**: Permission does not exist. The app automatically defaults to SAF mode with zero prompt.
- **`FOREGROUND_SERVICE`**:
  - **API 28+ (Android 9+)**: Declared in Manifest.
  - **API 24 – 27**: Handled without runtime permission.
- **`FOREGROUND_SERVICE_DATA_SYNC`**:
  - **API 34+ (Android 14+)**: Declared in Manifest and passed as `ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC` in `ForegroundInfo`.
  - **API 24 – 33**: Standard `ForegroundInfo(id, notification)` without service type.

### B. Notification Channels
- **API 26+ (Android 8.0+)**: `NotificationChannel` created with `NotificationManager.IMPORTANCE_LOW` before foreground notification is posted.
- **API 24 – 25**: Notifications built directly via `NotificationCompat.Builder` without channel ID requirement.

### C. Background Execution & WorkManager
- **API 24 – 36**: Unified WorkManager `CoroutineWorker` (`BackupWorker`, `ReconciliationWorker`).
- Background jobs are event-driven (`USB_DEVICE_ATTACHED`, `BOOT_COMPLETED`), enqueued with `ExistingWorkPolicy.KEEP` to eliminate duplicate execution.
- Foreground service promotion (`promoteToForegroundIfPossible()`) occurs on API 24–36, ensuring long transfers are never killed by OEM battery optimizations.

---

## 3. Dependency Compatibility Verification

| Dependency | Version | Official minSdk | API 24 Support Status |
|---|---|---|---|
| **Firebase BoM** | `34.17.0` | API 21+ | **PASS** — Main modules (`firebase-auth`, `firebase-firestore`) fully support API 24. |
| **AndroidX WorkManager** | `2.9.1` | API 19+ | **PASS** — Supports API 24+. Reliable JobScheduler/AlarmManager fallback under the hood. |
| **AndroidX Room** | `2.6.1` | API 19+ | **PASS** — SQLite migrations, DAOs, and transactions fully functional on API 24. |
| **AndroidX Core KTX** | `1.13.1` | API 19+ | **PASS** — Backport utilities and compat wrappers fully support API 24. |
| **Robolectric** | `4.12.2` | API 21+ | **PASS** — Multi-SDK test coverage across 24, 25, 26, 28, 29, 30, 33, 34+. |

---

## 4. Known Limitations & Edge Cases

1. **API 24–29 SAF Picker Delay**:
   - On Android 7.0–10.0, each *new* physical USB volume requires a one-time document tree selection. Once selected, persistable URI permissions retain access across all subsequent attachments and reboots without user interaction.
2. **Force-Stop Behavior**:
   - On all Android versions (API 24–36), user-initiated force-stop halts WorkManager and broadcast receivers until the app is next launched by the user.
3. **App Data Clear**:
   - Clearing app data revokes SAF URI permissions and wipes Room state. Setup must run once upon reopening.

---

## 5. Physical Validation Checklist (Pending Hardware)

- [ ] Connect USB drive to physical Android 7.0 (API 24) device and verify `USB_DEVICE_ATTACHED` broadcast.
- [ ] Verify SAF tree picker allows selecting removable OTG root on API 24.
- [ ] Verify `ContentResolver.takePersistableUriPermission()` survives reboot on API 24.
- [ ] Verify `MANAGE_EXTERNAL_STORAGE` direct file access on physical Android 14+ (API 34+) device.
