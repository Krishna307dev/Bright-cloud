# Smart Backup Policy

## Overview

USBCloudBackup implements a dual-mode **Smart Backup Policy** to balance bandwidth, cloud storage, and user visibility. Files discovered on connected USB mass storage devices are classified based on their file extension into:

1. **Category A (Automatic Cloud Backup)**: Essential documents, images, audio files, and archives are automatically hashed, deduplicated, and uploaded to Cloudflare R2 with full Firestore indexing.
2. **Category B (Metadata-Only Indexing)**: Large video files, executables, disk images, and other unlisted formats are indexed in Cloud Firestore as metadata-only records (`backupMode = "METADATA_ONLY"`, `status = "METADATA_INDEXED"`). Their binary bytes are not read or uploaded to R2 during automatic backup.

---

## 1. Category A: Automatic Backup Extensions

Extension matching is case-insensitive.

### Documents
- `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.txt`, `.csv`, `.rtf`, `.odt`, `.ods`, `.odp`

### Images
- `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tiff`, `.svg`

### Audio
- `.mp3`, `.wav`, `.flac`, `.m4a`, `.aac`, `.ogg`

### Archives
- `.zip`, `.7z`, `.rar`, `.tar`, `.gz`

---

## 2. Category B: Metadata-Only Indexing

All unlisted, unknown, or heavy media formats default to `METADATA_ONLY`:
- Video: `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.webm`
- Executables & Packages: `.exe`, `.msi`, `.dmg`, `.apk`, `.bin`, `.iso`, `.img`
- System/Data: `.db`, `.sqlite`, `.raw`, `.dat`

### Metadata-Only Workflow
1. Discovered during recursive filesystem scan.
2. Direct indexing in Firestore (`users/{uid}/files/{fileId}`) without reading full file content into RAM or calculating SHA-256 hash.
3. Marked as `FileStatus.METADATA_INDEXED` in Room local database.
4. Total job counter records `metadataOnlyFiles`.

---

## 3. On-Demand Backup Requests

Users browsing their backed-up files on the separate Web Viewer see both Category A and Category B files. If a user clicks **"BACKUP TO CLOUD"** on a Category B file:

1. The Web Viewer updates the Firestore document: `requestStatus = "REQUESTED"`.
2. The request is durable and survives reboots, app process death, and offline periods.
3. When the matching USB drive (`sourceId`) is attached to the Android phone:
   - `BackupWorker` queries `users/{uid}/files` for `requestStatus == "REQUESTED"`.
   - Matches the logical file identity (`sourceId + relativePath + originalName`).
   - Opens the physical USB stream and computes the **CURRENT** SHA-256 hash.
   - Performs content deduplication and transactional version reservation.
   - Streams binary bytes to Cloudflare R2.
   - Finalizes Firestore record with `status = "UPLOADED"`, `requestStatus = "COMPLETED"`, `storageBackend = "R2"`, and `r2ObjectKey`.
