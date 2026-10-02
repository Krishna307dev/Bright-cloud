---

# USB Access Decision

## Decision

**Use a hybrid approach: SAF (Storage Access Framework) as the primary USB storage access mechanism, with `MANAGE_EXTERNAL_STORAGE` as an optional accelerator for the private sideloaded use case.**

### Primary: SAF with per-volume persistent URI permissions
### Optional: `MANAGE_EXTERNAL_STORAGE` for direct `java.io.File` access (faster scanning, no per-volume picker)

The app must detect which mode is active and use the appropriate storage adapter.

## Why

### SAF is required because:

1. **`MANAGE_EXTERNAL_STORAGE` is NOT reliable for USB OTG access via `java.io.File` on all devices.** Research confirms that despite having the permission, OEM-specific vold implementations and SELinux policies can block direct file path access to USB drives mounted at `/storage/XXXX-XXXX/`. Developers report `EACCES` (Permission Denied) and `IllegalArgumentException` on certain devices.

2. **SAF is the only officially supported, cross-device approach** for accessing removable/USB storage content. Google explicitly recommends SAF for USB OTG access.

3. **SAF persistent URI permissions survive reboots.** Once the user selects a USB volume root via `ACTION_OPEN_DOCUMENT_TREE`, the app can call `ContentResolver.takePersistableUriPermission()` and retain access across reboots without further user interaction — but only for that specific volume.

### MANAGE_EXTERNAL_STORAGE is offered as optional because:

1. On AOSP/Pixel devices and many Samsung devices, `MANAGE_EXTERNAL_STORAGE` does grant `java.io.File` access to USB mounts.
2. `java.io.File` scanning is ~100x faster than SAF/DocumentFile.
3. For a private sideloaded app, the Play Store policy restriction is irrelevant.
4. It eliminates the per-volume document picker interaction requirement.

### The hybrid approach:

1. During first-run setup, check if the device supports `java.io.File` access to a removable volume with `MANAGE_EXTERNAL_STORAGE`.
2. If yes: use direct `java.io.File` access (fast path).
3. If no: fall back to SAF with per-volume user selection.
4. The storage access layer is behind an interface (`UsbStorageSource`) so both paths share the same downstream pipeline.

## Android API Evidence

| API | Level | Purpose |
|-----|-------|---------|
| `MANAGE_EXTERNAL_STORAGE` | 30+ | Broad file access |
| `Environment.isExternalStorageManager()` | 30+ | Check permission status |
| `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` | 30+ | Grant permission |
| `Intent.ACTION_OPEN_DOCUMENT_TREE` | 21+ | SAF directory picker |
| `ContentResolver.takePersistableUriPermission()` | 19+ | Persist SAF access |
| `DocumentFile.fromTreeUri()` | AndroidX | SAF file tree access |
| `DocumentsContract.buildChildDocumentsUri()` | 21+ | Fast SAF enumeration |
| `StorageManager.getStorageVolumes()` | 24+ | List mounted volumes |
| `StorageVolume.getDirectory()` | 30+ | Get volume root File |
| `StorageVolume.isRemovable()` | 24+ | Identify removable media |
| `StorageVolume.isPrimary()` | 24+ | Exclude internal storage |
| `StorageVolume.getUuid()` | 24+ | Volume identity |
| `StorageManager.registerStorageVolumeCallback()` | 30+ | Volume mount/unmount events |
| `UsbManager.getDeviceList()` | 12+ | Enumerate USB devices |
| `USB_DEVICE_ATTACHED` broadcast | 12+ | USB attach event |

## Target Android Versions

- **minSdk**: 24 (Android 7.0)
- **targetSdk**: 36 (Android 16)
- **compileSdk**: 36
- `MANAGE_EXTERNAL_STORAGE`: Available API 30+ (Android 11+). On API 24–29, this permission does not exist — use SAF on Android 7.0 through Android 10.
- `StorageVolume.getDirectory()`: API 30+. On API 24–29, standard SAF tree document URIs are used.

## First-Run Setup Flow

```text
App opens → MainActivity
  ↓
Check Environment.isExternalStorageManager()
  ↓
[If false] → Explain to user → Launch Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION
  ↓
[If true OR user declined] → Continue setup
  ↓
Request POST_NOTIFICATIONS permission (Android 13+)
  ↓
Firebase sign-in (anonymous → offer email upgrade)
  ↓
Check USB Host hardware support
  ↓
Test MANAGE_EXTERNAL_STORAGE path accessibility:
  - Get StorageManager.getStorageVolumes()
  - If a removable volume is currently attached, try File(volume.getDirectory()).listFiles()
  - If access works → record "direct_file_mode = true" in SharedPreferences
  - If access fails or no removable volume → record "direct_file_mode = false"
  - If no removable volume is attached → defer test to first USB attachment
  ↓
Persist setup-complete flag
  ↓
Show brief summary: "Setup complete. Plug in a USB drive to start backing up."
  ↓
Finish Activity
```

## USB Discovery Strategy

### Event Flow

```text
USB_DEVICE_ATTACHED (broadcast)
  ↓
UsbEventReceiver.onReceive()
  ↓
Identify USB device (vendor/product/serial)
  ↓
Check if mass storage (interface class 8)
  ↓
Wait for volume mount:
  Option A: registerStorageVolumeCallback (API 30+)
  Option B: Poll getStorageVolumes() every 2s for up to 30s
  ↓
Match new removable volume to USB device
  ↓
Determine access mode (direct_file vs SAF)
  ↓
If SAF mode AND no persisted URI for this volume:
  → Show notification: "New USB drive detected. Tap to grant access."
  → Notification opens Activity with ACTION_OPEN_DOCUMENT_TREE pre-navigated to volume
  → User selects root → takePersistableUriPermission()
  → Enqueue WorkManager backup chain
  ↓
If SAF mode AND persisted URI exists for this volume:
  → Verify persisted URI is still valid
  → Enqueue WorkManager backup chain
  ↓
If direct_file mode:
  → Use StorageVolume.getDirectory() or /storage/{uuid}/
  → Enqueue WorkManager backup chain
```

## USB Root Discovery

### Direct File Mode

```kotlin
val storageManager = getSystemService(StorageManager::class.java)
val volumes = storageManager.storageVolumes
val usbVolumes = volumes.filter { it.isRemovable && !it.isPrimary }

for (volume in usbVolumes) {
    val dir = volume.directory // API 30+, returns File?
    if (dir != null && dir.canRead()) {
        // Use dir as the root for scanning
    }
}
```

### SAF Mode

```kotlin
// From persisted URI permission
val persistedPermissions = contentResolver.persistedUriPermissions
for (permission in persistedPermissions) {
    val treeUri = permission.uri
    val rootDoc = DocumentFile.fromTreeUri(context, treeUri)
    if (rootDoc != null && rootDoc.exists()) {
        // Use rootDoc as the root for scanning
    }
}
```

### Matching USB Device to Volume

1. Record `UsbDevice` from `USB_DEVICE_ATTACHED`.
2. After volume mount, compare timing: if a new removable, non-primary volume appeared within 30s of USB attach, it's likely the USB volume.
3. Use `StorageVolume.getUuid()` as the stable volume identifier.
4. Store the mapping `usbDeviceFingerprint → volumeUuid` in Room.

## Multiple USB Devices

- Each USB storage device gets a separate mount point (`/storage/{uuid}/`).
- Each generates a separate `USB_DEVICE_ATTACHED` broadcast.
- Each can be backed up concurrently via separate WorkManager unique work chains.
- Work name format: `backup_{volumeUuid}` or `backup_{sourceId}`.
- Room database tracks each source independently via `SourceEntity.sourceId`.

## USB Disconnect/Reconnect

### Disconnect

1. File operations in progress throw `IOException`.
2. Worker catches exception, marks files as `SOURCE_UNAVAILABLE`.
3. Job status updated to `CANCELLED` or `PAUSED`.
4. `USB_DEVICE_DETACHED` may or may not be received (unreliable via manifest). Register dynamically in the worker.
5. Volume disappears from `StorageManager.getStorageVolumes()`.

### Reconnect

1. New `USB_DEVICE_ATTACHED` fires.
2. Volume re-mounts (possibly with same UUID).
3. App matches to existing SourceEntity via volume UUID.
4. Incomplete backup job detected in Room.
5. Resume from last successful state — files already UPLOADED/SKIPPED are not reprocessed.
6. Files in HASHING state: re-hash (partial hash is not useful).
7. Files in UPLOADING state: check Cloud Storage for existing object before re-uploading.

## Reboot Behavior

- `MANAGE_EXTERNAL_STORAGE`: Survives reboot. Still granted.
- SAF persistent URIs: Survive reboot.
- WorkManager jobs: Re-scheduled automatically after reboot.
- Room database: Preserved.
- Firebase auth: Preserved.
- `BOOT_COMPLETED` receiver: Fires after reboot.
- Boot reconciliation:
  1. `BOOT_COMPLETED` → receiver enqueues a `ReconciliationWorker`.
  2. Worker calls `UsbManager.getDeviceList()` to find connected USB devices.
  3. Worker calls `StorageManager.getStorageVolumes()` to find mounted volumes.
  4. Worker checks Room for incomplete backup jobs.
  5. If USB is still connected and volume is mounted: resume backup.
  6. If USB was removed: mark job as `SOURCE_UNAVAILABLE`, wait for reconnect.

- **USB connected before boot**: `USB_DEVICE_ATTACHED` is NOT re-delivered. The boot reconciliation worker discovers the device via `getDeviceList()` and `getStorageVolumes()`.

## Force-Stop Behavior

- `MANAGE_EXTERNAL_STORAGE`: **NOT revoked**.
- SAF persistent URIs: **NOT revoked**.
- WorkManager jobs: Preserved but **will not execute** until user manually opens the app again.
- Broadcasts: Will NOT be received until user opens the app.
- Room database: Preserved.
- Firebase auth: Preserved.
- **Documented limitation**: After force-stop, the app cannot perform automatic backups until the user opens it once.

## App Data Cleared Behavior

- `MANAGE_EXTERNAL_STORAGE`: **REVOKED**.
- SAF persistent URIs: **LOST** (stored in app's ContentResolver state).
- WorkManager jobs: **DELETED**.
- Room database: **DELETED**.
- Firebase auth: **DELETED** (anonymous UID lost forever).
- **Effect**: Complete reset. The app must go through first-run setup again.
- **Data in cloud**: Remains but is inaccessible if anonymous auth was used (UID lost).
- **Mitigation**: Prominently warn user during setup. Encourage email auth upgrade.

## Filesystem Compatibility

| Filesystem | Android Support | Notes |
|-----------|----------------|-------|
| FAT32 | Universal | Max file size 4GB. Widely supported. |
| exFAT | Android 10+ | Most modern devices. No 4GB limit. |
| NTFS | Limited | Kernel support varies by OEM. Many devices cannot mount. |
| ext4 | Not supported | Not intended for removable media on Android. |
| APFS/HFS+ | Not supported | Apple filesystems. |

- The app should handle unsupported filesystems gracefully: detect that the volume never mounts and notify the user.
- Timeout: If no volume mount occurs within 30 seconds of USB attach, show notification: "USB drive filesystem may not be supported."

## OEM Risks

| OEM | Risk | Mitigation |
|-----|------|------------|
| Xiaomi/Redmi | Aggressive battery optimization, may kill WorkManager. May block BOOT_COMPLETED. | Guide user to whitelist app in battery settings. |
| Huawei/Honor | Similar aggressive battery management. May have modified storage framework. | Same as Xiaomi. |
| Samsung | Generally reliable. Some models have custom USB notification with "Explore" option. | Test on target device. |
| Pixel/AOSP | Most reliable. Standard behavior. | Primary test target. |
| OnePlus/Oppo/Realme | Battery optimization can interfere. | Guide user to whitelist. |
| Vivo | Similar to Oppo. | Guide user to whitelist. |

**General mitigation**: During setup, if the app detects a known-problematic OEM, show guidance for disabling battery optimization for the app. Use `PowerManager.isIgnoringBatteryOptimizations()` to check. Optionally guide user via `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.

## SAF Fallback

SAF is not merely a fallback — it is the **primary mechanism**. `MANAGE_EXTERNAL_STORAGE` with direct file access is the optional accelerator.

The app always supports SAF. If `MANAGE_EXTERNAL_STORAGE` fails on a particular device or the user declines the permission:

1. App operates in SAF mode.
2. Each new USB volume requires a one-time user interaction via `ACTION_OPEN_DOCUMENT_TREE`.
3. Persistent URI permission eliminates repeat interactions for the same volume.
4. A notification guides the user to grant access when a new volume is detected.
5. For the scanning phase, use `ContentResolver.query()` with `DocumentsContract.buildChildDocumentsUri()` instead of slow `DocumentFile.listFiles()`.

**SAF does NOT violate the zero-interaction requirement** for known volumes — it only requires one-time interaction per NEW volume. After the initial grant, the same USB drive can be plugged in repeatedly without any user interaction.

## Physical Device Validation

### Must test before production use:

1. **Direct file access test**: With `MANAGE_EXTERNAL_STORAGE` granted, can `File("/storage/{uuid}/").listFiles()` read USB drive contents on the target device?
2. **SAF test**: Does `ACTION_OPEN_DOCUMENT_TREE` show the USB volume? Can the user select it?
3. **Persistent URI test**: After selecting USB root via SAF, does the URI permission survive reboot?
4. **Reconnect test**: After unplugging and replugging the same USB drive, does the persisted URI still work?
5. **Volume mount timing**: Measure delay between `USB_DEVICE_ATTACHED` and volume accessibility.
6. **Multiple drives**: Test with two USB drives via USB hub.
7. **Boot with USB connected**: Verify boot reconciliation finds the drive.

## Rejected Alternatives

### Alternative 1: SAF-only with no MANAGE_EXTERNAL_STORAGE
**Rejected because**: SAF scanning via DocumentFile is ~100x slower than java.io.File. For a private sideloaded app where MANAGE_EXTERNAL_STORAGE works, the performance penalty is unjustified. However, SAF is retained as the required fallback.

### Alternative 2: MANAGE_EXTERNAL_STORAGE only (no SAF)
**Rejected because**: Research confirms MANAGE_EXTERNAL_STORAGE does NOT reliably grant java.io.File access to USB OTG on all devices due to OEM-specific vold/SELinux restrictions. An app relying solely on this would fail on certain devices.

### Alternative 3: Custom USB mass storage protocol driver
**Rejected because**: Implementing a userspace FAT32/exFAT filesystem driver via USB bulk transfers is extremely complex, fragile, and unnecessary when Android already mounts the filesystem. The documentation explicitly prohibits this unless real-device testing proves standard access is impossible.

### Alternative 4: MediaStore for USB file access
**Rejected because**: MediaStore only indexes media files (images, video, audio). Non-media files like PDFs, documents, archives are not accessible through MediaStore. The backup app must handle all file types.

### Alternative 5: Root access
**Rejected because**: REQUIREMENTS.md NFR-12 explicitly requires no root access.
