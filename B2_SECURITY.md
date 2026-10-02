# Backblaze B2 Storage Security Architecture

## Overview

The production binary file storage backend for USBCloudBackup is **Backblaze B2** using its S3-compatible API.

- **Bucket**: `BrightCloud`
- **Endpoint**: `https://s3.eu-central-003.backblazeb2.com`
- **Region**: `eu-central-003`
- **Access Model**: Private bucket, short-lived AWS SigV4 Presigned URL authorization via secure backend gateway.

---

## Threat Model & Core Security Invariants

### 1. Zero Client Secrets
- The Android APK contains **no Backblaze Application Key IDs or Application Key Secrets**.
- All root Backblaze credentials (`B2_KEY_ID`, `B2_APPLICATION_KEY`) remain strictly server-side in secure secret storage / environment variables.

### 2. Token-Verified Owner Identity
- Android requests an authorization token by presenting a Google Firebase ID Token (JWT).
- The Backblaze B2 Authorizer backend cryptographically validates the token against Google's public JWKS certificates (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`).
- The verified UID is derived strictly from the verified JWT `sub` claim. Client-supplied UIDs in request bodies are ignored/forbidden.

### 3. Strict Scoped Prefix Enforcement
- All object keys are constrained to:
  ```text
  backups/{verifiedUid}/{sourceId}/{relativePath}{storedName}
  ```
- Any attempt to authorize an object key under another user's prefix (`backups/{otherUid}/...`) is rejected with `403 Forbidden`.

### 4. Path Traversal & Injection Protection
- Object keys containing `..`, `%2e%2e`, `\0`, or backslashes `\` are rejected with `400 Bad Request`.

### 5. Short-Lived Scoped Presigned S3 URLs
- The backend issues AWS SigV4 query-string presigned PUT and HEAD URLs direct to `https://s3.eu-central-003.backblazeb2.com/BrightCloud/...` with a 1-hour TTL.
- The signed URL binds the exact HTTP method (`PUT`), exact object key, and required metadata headers (`x-amz-meta-sha256`, `x-amz-meta-source-id`, `x-amz-meta-original-name`, `x-amz-meta-file-id`).

### 6. Direct Client-to-B2 Streaming (No Proxy Bottlenecks)
- Android streams raw bytes directly to Backblaze B2 S3 presigned URLs in bounded 64 KB chunks.
- No whole-file byte proxying through the backend, avoiding RAM exhaustion and serverless request body size limits.
