# Background Execution Strategy

## Architectural Lifecycle

The application operates as an event-driven background pipeline. It maintains **NO permanent idle background service or polling loop**.

```text
USB ATTACHED / BOOT
       │
       ▼
UsbEventReceiver / BootReceiver
       │
       ▼
UsbDeviceCoordinator (Registers volume callback / matches StorageVolume)
       │
       ▼
Enqueue WorkManager Chain (`backup_{sourceId}`, ExistingWorkPolicy.KEEP)
       │
       ▼
ScanWorker ──► HashWorker ──► DeduplicationWorker ──► UploadWorker
                                                            │
                                                            ▼
                                           Foreground Promotion (`dataSync` FGS)
                                                            │
                                                            ▼
                                                        COMPLETE ──► IDLE
```

---

## WorkManager Integration

- **Chain Execution**: `ScanWorker` ──► `HashWorker` ──► `DeduplicationWorker` ──► `UploadWorker`.
- **Unique Work**: `WorkManager.beginUniqueWork("backup_" + sourceId, ExistingWorkPolicy.KEEP, scanWork)...`.
- **Foreground Promotion**: During long-running transfers in `UploadWorker`, the worker calls `setForeground(ForegroundInfo(notificationId, notification, FOREGROUND_SERVICE_TYPE_DATA_SYNC))` to prevent process termination.
- **Constraints**:
  - `ScanWorker`, `HashWorker`, `DeduplicationWorker`: No network constraint.
  - `UploadWorker`: `NetworkType.CONNECTED` constraint.

---

## Android Version Compliance

### Android 12 (API 31)
- BroadcastReceiver delegates immediately to WorkManager.
- PendingIntents for USB permissions explicitly set `FLAG_IMMUTABLE`.

### Android 13 (API 33)
- `POST_NOTIFICATIONS` runtime permission requested during setup for foreground service progress notification display.

### Android 14 (API 34)
- `FOREGROUND_SERVICE_DATA_SYNC` permission declared in manifest.
- `foregroundServiceType="dataSync"` declared on foreground service in manifest.

### Android 15 & 16 (API 35 & 36)
- Compliance with Android 15 `dataSync` 6-hour execution limit per 24 hours. Large backup jobs are processed in distinct batches.
- Boot recovery is handled via `WorkManager` rescheduling rather than launching a Foreground Service directly from `BOOT_COMPLETED` receiver (preventing `ForegroundServiceStartNotAllowedException`).

---

## OEM Battery Optimization Resilience

- App detects aggressive battery management during setup.
- Displays guidance for user to whitelist app via `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
- Adheres strictly to Android public background execution APIs.
