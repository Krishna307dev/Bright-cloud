# Android APIs and Platform Contracts

## USB Host

Primary APIs:

-   `android.hardware.usb.UsbManager`
-   `android.hardware.usb.UsbDevice`
-   `android.hardware.usb.UsbInterface`
-   `android.hardware.usb.UsbEndpoint`
-   `android.hardware.usb.UsbDeviceConnection`
-   `UsbManager.ACTION_USB_DEVICE_ATTACHED`
-   `UsbManager.ACTION_USB_DEVICE_DETACHED`
-   `UsbManager.requestPermission(...)`
-   `UsbManager.hasPermission(...)`
-   `UsbManager.getDeviceList()`

The public Android API currently supports USB host mode.
`ACTION_USB_DEVICE_ATTACHED` is the documented attach event.

Important: a USB mass-storage device may be exposed through Android's
storage/document-provider stack rather than requiring the application to
implement a raw USB filesystem driver. Prefer the system storage
abstraction when it provides the required access.

## Storage Access Framework

Relevant APIs include:

-   `Intent.ACTION_OPEN_DOCUMENT_TREE`
-   `DocumentsContract`
-   `DocumentFile`
-   `ContentResolver.openInputStream(...)`
-   `ContentResolver.openFileDescriptor(...)`

Use SAF/document-provider APIs when the storage volume is exposed as a
document provider.

Do not assume `java.io.File` can directly represent every
removable-storage document URI.

## WorkManager

Use:

-   `WorkManager`
-   `CoroutineWorker`
-   `OneTimeWorkRequest`
-   constraints
-   backoff policy
-   unique work
-   foreground execution for genuinely long-running user-important work
    when required

WorkManager is the durable scheduling layer, not a substitute for USB
attach events.

## BroadcastReceiver

Potential receivers:

-   USB device attachment/detachment
-   boot completed where required
-   package replaced where useful for reinitialization

Do not assume broadcasts imply unlimited background execution.

## Foreground services

Do not run a permanent foreground service merely to wait for USB.

If long-running transfer execution requires foreground treatment, use
the Android-supported WorkManager foreground mechanism or a correctly
declared foreground service only when justified.

Android 15+ imposes a 6-hour-per-24-hour limit on `dataSync`
foreground-service execution for apps targeting Android 15+.

## Notifications

If Android requires foreground execution for a long-running worker, a
foreground notification may be mandatory. This is a platform requirement
and should not be treated as a UI/dashboard feature.

## File I/O

Use streaming APIs.

Never:

``` text
read entire 8 GB file into ByteArray
```

Use buffered streams or file descriptors and hash/upload incrementally.

## Cryptography

Use Android/Java standard cryptographic APIs such as:

``` text
MessageDigest.getInstance("SHA-256")
```

Do not implement SHA-256 manually.

## Public API rule

Do not use hidden APIs, reflection against non-SDK interfaces, root-only
APIs, OEM-private APIs, or undocumented filesystem paths.

Android 16 explicitly continues restricting non-SDK interfaces. Public
SDK alternatives are the required path.
