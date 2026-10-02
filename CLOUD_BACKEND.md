# Cloud Backend

## Primary Infrastructure

The USBCloudBackup cloud backend uses a hybrid architecture combining Firebase serverless services, a secure Backblaze B2 authorization backend, and Backblaze B2 binary object storage:

```text
┌─────────────────────────────────────────────────────────────┐
│                    Firebase Services                        │
│                                                             │
│  - Firebase Authentication: Authenticated owner identity    │
│    (Anonymous auth with optional Email/Password upgrade)    │
│                                                             │
│  - Cloud Firestore: Metadata store, SHA-256 content index,  │
│    filename reservations, backup requests, and job states   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ Firebase Auth ID Token (JWT)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│       Backblaze B2 Authorizer (backend/b2-authorizer/)      │
│                                                             │
│  - Cryptographically verifies Firebase ID token via JWKS    │
│  - Extracts verified owner UID from token 'sub' claim       │
│  - Enforces prefix restriction backups/{verifiedUid}/*      │
│  - Issues short-lived AWS SigV4 Presigned PUT/HEAD URLs     │
│    targeting Backblaze B2 S3 endpoint                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ Direct AWS SigV4 Presigned URL
                               ▼
┌─────────────────────────────────────────────────────────────┐
│            Backblaze B2 Storage (BrightCloud Bucket)        │
│                                                             │
│  - Backblaze B2: S3-compatible binary file object storage   │
│    (Raw, unaltered byte streams with zero compression or    │
│     transcoding for byte-for-byte fidelity)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Service Responsibilities

### 1. Firebase Authentication
- Manages user identity and session persistence.
- Provides a stable, authenticated `uid` for all data scoping.
- Supports Anonymous Authentication by default, with seamless upgrade to Email/Password via `linkWithCredential()`.
- The `uid` remains invariant across authentication method upgrades.

### 2. Cloud Firestore
- Houses all file metadata, source device registrations, and operational logs.
- Enforces O(1) content deduplication via the immutable `users/{uid}/contentHashes/{sha256}` index.
- Manages atomic filename version reservation via `users/{uid}/nameReservations/{resId}` with 24-hour TTL locks.
- Tracks backup session state in `users/{uid}/backupJobs/{jobId}`.
- Tracks Smart Backup Policy state (`backupMode: "AUTOMATIC" | "METADATA_ONLY"`) and on-demand user backup requests (`requestStatus: "NONE" | "REQUESTED" | "COMPLETED"`).

### 3. Backblaze B2 Authorization Backend (`backend/b2-authorizer/`)
- Intercepts authorization requests from the Android client (`POST /b2/upload-authorize`, `POST /b2/head-authorize`).
- Verifies Firebase JWTs using Google public X.509/JWKS certificates.
- Validates canonical object paths, rejects path traversal (`..`, `%2e%2e`, `\0`), and enforces owner prefix scoping (`backups/{verifiedUid}/*`).
- Generates AWS SigV4 Presigned PUT and HEAD URLs (TTL: 1 hour) directly for the Backblaze B2 S3 endpoint (`https://s3.eu-central-003.backblazeb2.com`, bucket `BrightCloud`).
- Direct client-to-B2 streaming bypasses backend proxy limits and ensures large-file capability without proxy memory overhead.

### 4. Backblaze B2 Object Storage
- Stores the physical binary byte streams of backed-up files in the private `BrightCloud` bucket.
- Provides high-durability, cost-effective binary storage with S3 API compatibility.
- Byte-for-Byte Fidelity: All files are stored in their native binary formats without compression, transcoding, or modification.
  - PDF: Original PDF bytes
  - Images (JPEG/PNG/WebP/SVG): Original image bytes
  - Audio (MP3/WAV/FLAC): Original audio bytes
  - Documents (DOCX/XLSX/PPTX): Original document bytes
  - Archives (ZIP/7Z/TAR/GZ): Original archive bytes

---

## Canonical Backblaze B2 Object Path

All files in Backblaze B2 follow the canonical key layout:

```text
backups/{uid}/{sourceId}/{relativePath}{storedName}
```

### Examples:
- `backups/abc123def456/1234-5678-SN001/README.txt`
- `backups/abc123def456/1234-5678-SN001/Notes/Math/CHAPTER_5.pdf`
- `backups/abc123def456/1234-5678-SN001/Notes/Math/CHAPTER_5(1).pdf`
- `backups/abc123def456/1234-5678-SN001/Photos/2026/vacation.jpg`

### S3 Custom Object Metadata
Every object uploaded to Backblaze B2 includes mandatory custom metadata headers:
- `x-amz-meta-sha256`: 64-character lowercase hex SHA-256 hash.
- `x-amz-meta-source-id`: Source device fingerprint string.
- `x-amz-meta-original-name`: Original filename on the USB drive.
- `x-amz-meta-file-id`: Firestore file document ID.

---

## Cloud Firestore Collection Hierarchy

All collections are strictly nested under `users/{uid}/`:

```text
users/
  {uid}/
    profile/
      settings          (single document: setupComplete, authMethod, timestamps)
    sources/
      {sourceId}/       (one per USB hardware fingerprint: vendorId, productId, serial)
    files/
      {fileId}/         (one per backed-up or metadata-only file)
    contentHashes/
      {sha256}/         (immutable content hash index for O(1) deduplication)
    backupJobs/
      {jobId}/          (backup session tracking & counters)
    nameReservations/
      {resId}/          (atomic version locks with 24-hour TTL)
```
