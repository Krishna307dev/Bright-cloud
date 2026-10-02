# Security Architecture & Access Control — Shared Vault

## Principles

1. **Storage Identity is Physical**: The physical pendrive is the storage identity (`sourceId`). Files from the same pendrive uploaded from any contributor phone land in the same shared vault directory (`backups/{vaultId}/{sourceId}/...`).
2. **Device ID != Human ID**:
   - **Anonymous Android Daemon**: Upload-only device agent (`DEVICE_UPLOAD`). Zero human identity, zero download capability, zero delete capability.
   - **Google-Authenticated Humans**: Web-only access. `HUMAN_ADMIN` holds full control (browse, download, web upload, delete, collaborator & permission management); `HUMAN_VIEWER` holds granular read/download access to permitted files/folders only.
3. **No Root Secrets in Clients**: Android APK and Web Viewer contain zero master credentials, service accounts, or B2 Application Keys.
4. **Server-Side Authorization**: The Cloudflare B2 Authorizer gateway validates Firebase JWTs and issues scoped, short-lived AWS SigV4 presigned URLs.

---

## Anonymous DEVICE_UPLOAD Security & Risk Analysis

### Security Controls for Anonymous Ingestion
1. **Server-Enforced Target Vault (`VAULT_ID`)**:
   - The B2 Authorizer backend strictly enforces the target `vaultId` from its server configuration (`env.VAULT_ID || "default"`).
   - Clients cannot inject arbitrary vault IDs or upload into unconfigured namespaces.
2. **Strict Capability Restriction (`DEVICE_UPLOAD`)**:
   - Anonymous Firebase tokens are granted ONLY presigned `PUT` and presigned `HEAD` (for crash recovery).
   - Any request by an anonymous token to `POST /b2/download-authorize` is rejected with `403 Forbidden: Devices cannot request download URLs`.
   - Deletion endpoints are forbidden for anonymous tokens (`403 Forbidden`).
3. **Key & Metadata Validation**:
   - Object key must match `backups/{vaultId}/{sourceId}/{relativePath}{storedName}`.
   - Path traversal (`..`, `%2e%2e`, `\`, null bytes) is rejected.
   - SHA-256 must be a 64-character lowercase hex string.
4. **Rate Limiting & Abuse Prevention**:
   - Token-bucket rate limiter per `deviceUid` / IP in Cloudflare Worker (max 60 upload authorizations/minute per device).
   - App Attestation / Firebase App Check support (`X-Firebase-AppCheck` verification).

### Residual Risk Analysis of Anonymous Authentication
- **Risk**: Firebase Anonymous Auth tokens can be created by any client with the project's public API configuration.
- **Mitigations in Architecture**:
  - **Upload-Only Surface**: An anonymous token cannot read, search, list, or download any existing backup data.
  - **Non-Destructive Invariant (I-001)**: Existing files and content hashes are immutable and cannot be overwritten. Collisions create versioned suffixes (`(1)`, `(2)`).
  - **Deduplication Engine**: Identical byte content is skipped, preventing storage exhaustion.
  - **Zero Access to Web Management**: Anonymous tokens cannot access user settings, collaborator management, or permission rules.

---

## B2 Authorizer Gateway Capabilities

| Capability | Allowed Operations | Denied Operations |
| :--- | :--- | :--- |
| **`DEVICE_UPLOAD`** (Anonymous Tokens) | • `POST /b2/upload-authorize` (SigV4 PUT)<br/>• `POST /b2/head-authorize` (SigV4 HEAD) | • `POST /b2/download-authorize` (403)<br/>• B2 DELETE (403) |
| **`HUMAN_ADMIN`** (Google Tokens in `adminUids`) | • `POST /b2/download-authorize` (SigV4 GET for all files)<br/>• `POST /b2/upload-authorize` (Manual Web Upload)<br/>• `POST /b2/head-authorize`<br/>• B2 DELETE | None |
| **`HUMAN_VIEWER`** (Google Tokens in `authorizedFriends`) | • `POST /b2/download-authorize` (SigV4 GET ONLY for permitted files) | • `POST /b2/upload-authorize` (403)<br/>• B2 DELETE (403)<br/>• Unpermitted files (403) |

---

## Local Security

- App-private local database stored in `/data/data/com.usbcloudbackup/databases/`.
- Android OS sandbox prevents other non-rooted apps from accessing app data.
- Transport security: All communication to Firebase and Backblaze B2 uses TLS 1.3.
