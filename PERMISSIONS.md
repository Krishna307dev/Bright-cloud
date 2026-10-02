# Permissions Strategy

## Manifest Declarations

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Network Access -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <!-- Background Work & Recovery -->
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />

    <!-- Storage Access (Hybrid Strategy) -->
    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />

    <!-- Notifications (Android 13+) -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <!-- Hardware Feature Requirement -->
    <uses-feature android:name="android.hardware.usb.host" android:required="true" />
</manifest>
```

---

## Permission Flow & Acquisition

### First-Run Setup (Activity)
1. **Notifications (`POST_NOTIFICATIONS`)**: Requested via standard runtime permission dialog on Android 13+ (API 33+).
2. **All Files Access (`MANAGE_EXTERNAL_STORAGE`)**: Redirects user to `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`. If granted, enables direct file scanning mode.
3. **SAF Root Permission (Fallback / Secondary)**: If `MANAGE_EXTERNAL_STORAGE` is not active, `Intent.ACTION_OPEN_DOCUMENT_TREE` is launched when a new USB volume is attached. `ContentResolver.takePersistableUriPermission()` persists access across reboots.

### Hardware USB Permission
- USB permission requested via `UsbManager.requestPermission()` with a `PendingIntent` specifying `FLAG_IMMUTABLE`.
- Combined with `res/xml/usb_device_filter.xml` intent filter for auto-grant behavior when user checks "always open with this app".

---

## Permission Lifecycle & Survival

| Permission | Reboot | Force-Stop | Clear Data | Reinstall |
|------------|--------|------------|------------|-----------|
| `MANAGE_EXTERNAL_STORAGE` | Preserved | Preserved | Revoked | Revoked |
| SAF Persisted URI | Preserved | Preserved | Lost | Lost |
| `POST_NOTIFICATIONS` | Preserved | Preserved | Revoked | Revoked |
| USB Hardware Permission | Revoked (Per-session) | Revoked | Revoked | Revoked |

*Note: USB hardware permission is auto-reacquired on connection when using intent filter association.*
