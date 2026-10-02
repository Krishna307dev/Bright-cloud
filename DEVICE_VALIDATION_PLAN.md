---

# Device Validation Plan

## Purpose

This document defines the physical device testing matrix that must be completed before the backup pipeline is considered production-ready. Many behaviors cannot be verified in emulators or unit tests.

## Target Device

The exact phone model and Android version will be confirmed by the developer. Until then, all tests assume:

- Android 14+ (API 34+)
- USB Host mode supported
- USB OTG adapter available

## Test Equipment

### Required
- Target Android phone
- USB OTG adapter (USB-C to USB-A or direct USB-C drive)
- USB flash drive #1: FAT32 formatted, 8-32GB
- USB flash drive #2: exFAT formatted, 32-128GB
- USB flash drive #3: Large capacity (128GB+) with 10,000+ files
- USB hub (for multi-device tests)

### Recommended
- Second Android phone (different OEM) for OEM comparison
- NTFS-formatted drive (to test unsupported filesystem handling)

## Test Matrix

### Category 1: USB Hardware Detection

| ID | Test | Expected Result | Status |
|----|------|----------------|--------|
| DV-01 | Connect USB drive with app installed | USB_DEVICE_ATTACHED broadcast received | ☐ |
| DV-02 | Disconnect USB drive | USB_DEVICE_DETACHED detected (dynamic receiver) | ☐ |
| DV-03 | Connect USB drive after boot (already plugged in during boot) | Boot reconciliation detects the drive | ☐ |
| DV-04 | Connect USB drive via USB hub | Drive detected same as direct connection | ☐ |
| DV-05 | Connect two USB drives simultaneously (hub) | Both detected independently | ☐ |
| DV-06 | Rapid connect/disconnect/reconnect | No crash, no duplicate work chains | ☐ |
| DV-07 | Connect non-storage USB device (keyboard, mouse) | Not treated as backup source | ☐ |

### Category 2: Storage Access

| ID | Test | Expected Result | Status |
|----|------|----------------|--------|
| DV-08 | MANAGE_EXTERNAL_STORAGE: File access on USB (if granted) | Can read /storage/{uuid}/ via java.io.File | ☐ |
| DV-09 | SAF: Select USB root via document picker | URI permission granted, files accessible | ☐ |
| DV-10 | SAF: Persistent URI survives reboot | Access works after reboot without re-selecting | ☐ |
| DV-11 | SAF: Persistent URI works after USB disconnect/reconnect | Access works for same USB drive | ☐ |
| DV-12 | Volume mount timing: delay after USB_DEVICE_ATTACHED | Measure delay, verify wait mechanism works | ☐ |

### Category 3: File Operations

| ID | Test | Expected Result | Status |
|----|------|----------------|--------|
| DV-13 | Scan USB with 100 files | All files discovered, correct metadata | ☐ |
| DV-14 | Scan USB with 10,000+ files | Completes within reasonable time, no OOM | ☐ |
| DV-15 | Scan USB with deeply nested directories (10+ levels) | All files found | ☐ |
| DV-16 | Scan USB with Unicode filenames | Filenames preserved correctly | ☐ |
| DV-17 | Scan USB with spaces and special characters | Filenames handled correctly | ☐ |
| DV-18 | Scan USB with very long filenames (200+ chars) | Handled gracefully (truncate or hash) | ☐ |
| DV-19 | Hash a 1MB file from USB | Correct SHA-256, completes quickly | ☐ |
| DV-20 | Hash a 1GB file from USB | Correct SHA-256, no OOM, progress reported | ☐ |
| DV-21 | Hash a 4GB+ file from USB (exFAT only) | Correct SHA-256, streaming works | ☐ |
| DV-22 | FAT32 formatted drive | All operations work | ☐ |
| DV-23 | exFAT formatted drive | All operations work | ☐ |
| DV-24 | NTFS formatted drive | Graceful failure with user notification | ☐ |

### Category 4: Upload and Cloud

| ID | Test | Expected Result | Status |
|----|------|----------------|--------|
| DV-25 | Upload single small file (1MB) | File in Cloud Storage, metadata in Firestore | ☐ |
| DV-26 | Upload single large file (500MB) | Completes, progress shown, foreground service | ☐ |
| DV-27 | Upload 100 files | All uploaded, correct metadata | ☐ |
| DV-28 | Deduplication: same content, same name | File skipped | ☐ |
| DV-29 | Deduplication: same content, different name | File skipped | ☐ |
| DV-30 | Version naming: same name, different content | Creates name(1).pdf | ☐ |
| DV-31 | Version naming: repeated changes | Creates name(2).pdf, name(3).pdf, etc. | ☐ |

### Category 5: Interruption and Recovery

| ID | Test | Expected Result | Status |
|----|------|----------------|--------|
| DV-32 | USB disconnect during scan | Job paused, no corrupt state | ☐ |
| DV-33 | USB disconnect during hash | Partial hash discarded, job paused | ☐ |
| DV-34 | USB disconnect during upload | Upload stops, state preserved | ☐ |
| DV-35 | USB reconnect after disconnect | Job resumes, no duplicates | ☐ |
| DV-36 | Network off during upload | Upload pauses, WorkManager waits | ☐ |
| DV-37 | Network restored after offline | Upload resumes automatically | ☐ |
| DV-38 | Kill app process during upload | WorkManager re-schedules, state recovered | ☐ |
| DV-39 | Reboot during upload | After boot, work resumes | ☐ |
| DV-40 | Kill app process after upload, before Firestore write | Recovery writes Firestore metadata | ☐ |
| DV-41 | Force-stop app | App stops, resumes when user opens it | ☐ |
| DV-42 | Clear app data | Full reset, re-setup required | ☐ |

### Category 6: OEM-Specific

| ID | Test | Expected Result | Status |
|----|------|----------------|--------|
| DV-43 | Battery optimization: app not whitelisted | Document behavior | ☐ |
| DV-44 | Battery optimization: app whitelisted | Background work runs reliably | ☐ |
| DV-45 | BOOT_COMPLETED delivery | Receiver fires after reboot | ☐ |
| DV-46 | Foreground service notification (Android 13+) | Notification shown, service runs | ☐ |

### Category 7: End-to-End

| ID | Test | Expected Result | Status |
|----|------|----------------|--------|
| DV-47 | Complete flow: plug in USB → automatic backup → verify cloud | All files backed up correctly | ☐ |
| DV-48 | Second plug-in of same USB (no changes) | All files skipped (dedup) | ☐ |
| DV-49 | Second plug-in with one changed file | One new version uploaded | ☐ |
| DV-50 | Different USB drive with some identical files | Identical files skipped, unique files uploaded | ☐ |

## Test Result Documentation

For each test, record:
- Device model and Android version
- Date tested
- Pass/Fail
- Observations and timing measurements
- Screenshots if relevant

Results should be documented in `docs/test-results/device-validation-{date}.md`.

## Assumptions Until Device Testing

These assumptions are marked as **UNVERIFIED** until physical device testing confirms them:

1. USB_DEVICE_ATTACHED broadcast is delivered to manifest receiver on target device
2. MANAGE_EXTERNAL_STORAGE grants java.io.File access to USB on target device
3. SAF shows USB volume in document picker on target device
4. SAF persistent URI survives USB disconnect/reconnect for same drive
5. BOOT_COMPLETED is delivered on target device OEM
6. WorkManager executes reliably on target device OEM
7. Foreground service with dataSync type runs correctly on target Android version
