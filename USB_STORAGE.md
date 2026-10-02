# USB and External Storage Strategy

## Core Principles

USB mass storage devices connected via OTG are exposed through Android's storage layer. The app uses a **hybrid storage access architecture**:

1. **Direct File Mode (`MANAGE_EXTERNAL_STORAGE`)**:
   - Used when `Environment.isExternalStorageManager()` is true and `/storage/{uuid}/` is accessible.
   - Provides direct `java.io.File` access with ~100x faster file enumeration.
2. **SAF Mode (Storage Access Framework)**:
   - Officially supported cross-device fallback.
   - Uses `ACTION_OPEN_DOCUMENT_TREE` for root access grant, followed by `takePersistableUriPermission()`.
   - Access via `ContentResolver.openInputStream()` and `DocumentsContract.buildChildDocumentsUri()`.

For full trade-off analysis, see [USB_ACCESS_DECISION.md](USB_ACCESS_DECISION.md).

---

## Detection & Volume Mount Strategy

1. `UsbEventReceiver` catches `USB_DEVICE_ATTACHED` broadcast (filtered by `usb_device_filter.xml` for mass storage class 8).
2. Hardware attachment precedes storage volume mounting by 1-10 seconds.
3. `UsbDeviceCoordinator` waits for volume mount by registering a `StorageVolumeCallback` via `StorageManager.registerStorageVolumeCallback()` (API 30+) or polling `StorageManager.getStorageVolumes()` for up to 30 seconds.
4. Once volume state is `MEDIA_MOUNTED`, volume UUID (`StorageVolume.getUuid()`) is extracted.
5. Source fingerprint created: `{vendorId}-{productId}-{serialOrHash}`.
6. WorkManager enqueues unique work chain tagged `backup_{sourceId}` with `ExistingWorkPolicy.KEEP`.

---

## USB Detach & Error Handling

- Dynamic broadcast receiver registered during background execution to catch detachment events.
- Physical detachment during active reads/uploads throws `IOException`.
- Exception caught cleanly; Room task marked `SOURCE_UNAVAILABLE`.
- Pipeline pauses without corrupting database state or leaving orphan locks.
- Re-attaching the same USB volume resumes processing from last uncompleted step.

---

## Boot & Re-attachment Reconciliation

- `UsbManager.getDeviceList()` and `StorageManager.getStorageVolumes()` queried on `BOOT_COMPLETED` by `ReconciliationWorker`.
- Drives attached prior to device boot (which do not trigger `USB_DEVICE_ATTACHED` post-boot) are automatically discovered and processed.
- No background polling loop or permanent idle service is used.
