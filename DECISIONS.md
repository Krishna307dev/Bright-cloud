# Architecture Decisions Log

## Summary of Architectural Decisions (ADR-001 to ADR-020)

### ADR-001: Event-Driven USB Background Execution
- **Decision**: Use `UsbManager` attach broadcast + `StorageManager` volume callback + `WorkManager`.
- **Rationale**: Avoids permanent idle foreground services and battery drain. Modern Android compliant.

### ADR-002: Hybrid Storage Access Strategy
- **Decision**: Use Storage Access Framework (SAF) as primary cross-device standard, with `MANAGE_EXTERNAL_STORAGE` as performance accelerator for private sideloaded deployment.
- **Rationale**: `MANAGE_EXTERNAL_STORAGE` enables `java.io.File` scanning (~100x faster), but SAF provides guaranteed fallback on devices where `/storage/` path access is restricted.
- **Spec**: [USB_ACCESS_DECISION.md](USB_ACCESS_DECISION.md)

### ADR-003: SHA-256 for Content Identity
- **Decision**: Use streaming SHA-256 hash as absolute content identity for deduplication.
- **Rationale**: Filename, date, and size cannot reliably identify content across devices.

### ADR-004: Global Content Deduplication
- **Decision**: Skip uploading any file whose SHA-256 exists in Firestore `users/{uid}/contentHashes/{sha256}`.
- **Rationale**: Prevents storing duplicate byte streams across different USB drives or directories.

### ADR-005: Same-Name Changed-File Versioning
- **Decision**: Never overwrite cloud files. Use `basename(N).ext` naming pattern (`(1)`, `(2)`, `(3)`).
- **Rationale**: Preserves complete file version history and prevents accidental data loss.

### ADR-006: User-Scoped Nested Firestore Schema
- **Decision**: Nest all Firestore collections under `users/{ownerUid}/`.
- **Rationale**: Simplifies security rules, enforces strict single-owner isolation, and works seamlessly across Anonymous and Email authentication.
- **Spec**: [FIRESTORE_SCHEMA.md](FIRESTORE_SCHEMA.md)

### ADR-007: Standardized Canonical Object Paths
- **Decision**: Layout: `backups/{ownerUid}/{sourceId}/{relativePath}{storedName}` with custom object metadata `x-amz-meta-sha256`.
- **Rationale**: Clean device isolation, directory structure preservation, and crash recovery metadata.
- **Spec**: [B2_STORAGE_SCHEMA.md](B2_STORAGE_SCHEMA.md)

### ADR-008: Modern Firebase Dependencies (BoM 34.17.0)
- **Decision**: Use base Firebase artifacts (`firebase-auth`, `firebase-firestore`) without deprecated `-ktx` suffixes.
- **Rationale**: Firebase BoM 34.0.0+ removed separate KTX modules; Kotlin extensions are in main artifacts.
- **Spec**: [FIREBASE_DEPENDENCIES.md](FIREBASE_DEPENDENCIES.md)

### ADR-009: Upload-First, Index-Second Upload Pipeline with Session Resume
- **Decision**: Upload bytes to object storage first, save upload state, then execute atomic Firestore finalization transaction.
- **Rationale**: Resolves cross-service consistency. Un-indexed objects are recoverable via `ReconciliationWorker`; un-uploaded index records are avoided.
- **Spec**: [CLOUD_CONSISTENCY.md](CLOUD_CONSISTENCY.md)

### ADR-010: Transactional Name Reservations with 24-Hour TTL
- **Decision**: Reserve versioned filenames in Firestore `users/{ownerUid}/nameReservations/{resId}` via transactions with 24h TTL.
- **Rationale**: Prevents race conditions between concurrent workers while ensuring failed uploads don't permanently lock filename slots.
- **Spec**: [NAME_RESERVATION.md](NAME_RESERVATION.md)

### ADR-011: Strict Enforcement of System Invariants
- **Decision**: Adopt System Invariants I-001 through I-015.
- **Rationale**: Guarantees zero overwrites, zero duplicate content uploads, crash safety, byte fidelity, and data integrity.
- **Spec**: [INVARIANTS.md](INVARIANTS.md)

### ADR-012: Minimal Setup-Only Activity (No Dashboard)
- **Decision**: App Activity is setup-only. Closes after first run and remains headless.
- **Rationale**: Normal backup operation is background-driven and requires no user interface.

### ADR-013: System Resilience & Error Recovery Architecture
- **Decision**: Standardize error classification via `FirebaseErrorClassifier` and handle process death, ambiguous network responses, USB disconnects, and reservation recovery atomically.
- **Rationale**: Ensures the backup engine is interruption-safe, recovery-safe, crash-safe, and idempotent under all failure scenarios.
- **Spec**: [RESILIENCE_MATRIX.md](RESILIENCE_MATRIX.md)

### ADR-014: Cloudflare R2 Binary Storage Backend (Historical Migration — Superseded by ADR-018)
- **Decision**: Physical binary object storage previously migrated to Cloudflare R2 before final migration to Backblaze B2 in ADR-018.
- **Rationale**: Superseded by ADR-018 (Backblaze B2 / BrightCloud).
- **Spec**: [B2_STORAGE_SCHEMA.md](B2_STORAGE_SCHEMA.md), [CLOUD_BACKEND.md](CLOUD_BACKEND.md)

### ADR-015: Smart Backup Policy & On-Demand Web Requests
- **Decision**: Automatically back up Category A files (documents, images, audio, archives) while indexing Category B files (large video, executables) as metadata-only by default. When a user requests backup of a Category B file from the web viewer, the Android worker uploads the binary bytes upon USB attachment.
- **Rationale**: Optimizes bandwidth and storage while giving the user full visibility of USB contents and on-demand cloud upload capability.
- **Spec**: [STATE_MACHINE.md](STATE_MACHINE.md), [FIRESTORE_SCHEMA.md](FIRESTORE_SCHEMA.md)

### ADR-016: Android 7.0 (API Level 24) Minimum SDK Compatibility Migration
- **Decision**: Lower `minSdk` from 29 to 24 (Android 7.0 Nougat) while maintaining `targetSdk = 36` and `compileSdk = 36`. Use SAF as standard access strategy on API 24–29, with `MANAGE_EXTERNAL_STORAGE` direct file access on API 30+.
- **Rationale**: Expands application hardware reach to legacy Android 7.0+ devices while retaining modern high-speed direct access on newer Android versions behind clean platform adapters.
- **Spec**: [ANDROID_COMPATIBILITY.md](ANDROID_COMPATIBILITY.md), [USB_ACCESS_DECISION.md](USB_ACCESS_DECISION.md)

### ADR-017: Cloudflare Worker Authorization Backend (Archived Architecture)
- **Decision**: Historical migration note: Previously utilized Cloudflare Worker for R2 authorization.
- **Rationale**: Replaced by ADR-018.

### ADR-018: Migration to Backblaze B2 S3 Binary Storage Backend
- **Decision**: Migrate the production binary file storage backend from Cloudflare R2 to Backblaze B2 (`BrightCloud` bucket at `https://s3.eu-central-003.backblazeb2.com`, region `eu-central-003`). Firebase Auth remains the identity provider, and Cloud Firestore remains the metadata and index store.
- **Rationale**: Backblaze B2 provides enterprise-grade, high-durability private S3-compatible object storage. The Backblaze B2 authorizer (`backend/b2-authorizer/`) cryptographically verifies Firebase JWTs via Google JWKS, derives the owner UID from the verified `sub` claim, and generates AWS SigV4 query-string presigned PUT and HEAD URLs directly targeting Backblaze B2. Android streams directly to Backblaze B2 in bounded 64 KB chunks with zero client-side master secrets and zero byte proxying through backend servers.
- **Spec**: [B2_SECURITY.md](B2_SECURITY.md), [B2_STORAGE_SCHEMA.md](B2_STORAGE_SCHEMA.md), [CLOUD_BACKEND.md](CLOUD_BACKEND.md), [backend/b2-authorizer/README.md](backend/b2-authorizer/README.md)

### ADR-019: Owner Admin + Viewer-Only Friends Access Control Model
- **Decision**: Implement an Owner Admin + Viewer-Only Friends collaboration model. The owner (`ownerUid`) holds full database management, manual web upload, collaborator management, and deletion rights. 3–4 friends (Google Sign-In) hold strictly read-only access to browse metadata and download files via short-lived Backblaze B2 GET URLs. Friends are denied upload, edit, delete, and collaborator management capabilities.
- **Rationale**: Balances seamless sharing with friends while strictly securing master metadata, deduplication indexes, and write privileges against unintended modification or deletion.
- **Spec**: [ACCESS_CONTROL_SPEC.md](ACCESS_CONTROL_SPEC.md), [SECURITY.md](SECURITY.md), [FIRESTORE_SCHEMA.md](FIRESTORE_SCHEMA.md)

### ADR-020: Secure Owner-Device Identity Pairing Protocol
- **Decision**: Decouple the Android headless daemon's initial local identity from the Web Viewer Owner account using a secure 10-minute ephemeral claim code mechanism (`deviceClaims/{claimId}`) or direct Google Sign-In during setup.
- **Rationale**: Eliminates the need to embed permanent master secrets or passwords into the Android APK while ensuring USB backups belong to the canonical `ownerUid` namespace.
- **Spec**: [DEVICE_PAIRING_SPEC.md](DEVICE_PAIRING_SPEC.md)
