# Access Control Specification — Shared Vault & Role-Based Access

## 1. Overview & Core Philosophy

USBCloudBackup operates on a strict **Shared-Vault, Physical-Identity Architecture**:
- **Storage Identity is Physical**: The physical USB flash drive (`sourceId`) is the storage identity. Files uploaded from any phone plugging in the same physical pendrive land in the **same directory** within the shared vault (`backups/{vaultId}/{sourceId}/...`).
- **Device Identity != Human Identity**:
  - **Android Background Daemon**: Uses Firebase Anonymous Authentication as an ephemeral device-agent credential. It is an **UPLOAD-ONLY** headless agent. It has zero human identity, zero Google sign-in, zero pairing codes, zero download capability, and zero delete capability.
  - **Web Viewer (Humans)**: Uses Google Authentication. Humans interact only via the browser.
    - **Owner / Admin**: Full control over metadata, files, manual web uploads, deletions, user whitelisting, and per-file/per-folder access rules.
    - **Friends / Viewers**: Read-only access restricted strictly to files and folders explicitly permitted by the Admin. Strictly prohibited from uploading, deleting, modifying metadata, or managing permissions.

---

## 2. Four Independent Identities

| Identity Dimension | Identifier Format | Purpose | Authorization Scope |
| :--- | :--- | :--- | :--- |
| **DEVICE UID** | Firebase Anonymous UID (`anon_xxx`) | Identifies background Android daemon installation | **DEVICE_UPLOAD only** (Presigned B2 PUT/HEAD; Firestore ingest). Zero read/download/delete. |
| **SOURCE ID** | `{vid}-{pid}-{volumeUuid}` | Stable physical pendrive identity | Defines the directory namespace under the vault. Invariant across all phones. |
| **GOOGLE UID** | Firebase Google UID (`goog_xxx`) | Identifies a human accessing the Web Viewer | **HUMAN_ADMIN** (full control) or **HUMAN_VIEWER** (granular read/download). |
| **VAULT ID** | Configured string (e.g. `default`) | Shared project & storage boundary | Enclosing container for all sources, files, and permissions. |

---

## 3. Capability Matrix

| Capability | DEVICE_UPLOAD (Anonymous Daemon) | HUMAN_ADMIN (Google Sign-In) | HUMAN_VIEWER (Google Sign-In) | Unauthenticated / Third Party |
| :--- | :---: | :---: | :---: | :---: |
| **Authentication** | Firebase Anonymous Auth | Google Auth (`adminUids`) | Google Auth (`authorizedFriends`) | None |
| **Presigned B2 PUT (Upload)** | **ALLOWED** (USB Ingestion) | **ALLOWED** (Manual Web Upload) | **DENIED (403)** | Denied (401) |
| **Presigned B2 HEAD (Recovery)** | **ALLOWED** (Integrity Check) | **ALLOWED** | **DENIED (403)** | Denied (401) |
| **Presigned B2 GET (Download)** | **DENIED (403)** | **ALLOWED** (All files) | **ALLOWED** (Permitted files only) | Denied (401) |
| **B2 Object Deletion** | **DENIED (403)** | **ALLOWED** (Via Admin) | **DENIED (403)** | Denied (401) |
| **Firestore Metadata Write** | **ALLOWED** (Sources, Files, Jobs) | **ALLOWED** (Full Control) | **DENIED** | Denied (401) |
| **Firestore Metadata Read** | **INTERNAL** (Collision/Dedup checks) | **ALLOWED** (All Files) | **ALLOWED** (Permitted Files) | Denied (401) |
| **Manage Access & Permissions** | **DENIED** | **ALLOWED** | **DENIED** | Denied (401) |
| **Content Hash Index Mutation** | Create Only (Immutable) | Create Only (Immutable) | **DENIED** | Denied (401) |

---

## 4. Backblaze B2 Object Storage Architecture

### Object Key Structure
```text
backups/{vaultId}/{sourceId}/{relativePath}{storedName}
```
- `{vaultId}`: Fixed vault identifier configured server-side (e.g. `default`).
- `{sourceId}`: Deterministic USB identity: `{vendorId}-{productId}-{volumeUuid}`.
- `{relativePath}`: Directory path from USB root (e.g. `Photos/2026/`).
- `{storedName}`: Preserved filename (or versioned collision name: `document(1).pdf`).
- **Human and device UIDs are NEVER included in the object path.**

### B2 Authorizer Gateways (Cloudflare Worker)
```text
                                  ┌───────────────────────────┐
                                  │   B2 Authorizer Backend   │
                                  │  (Firebase JWT Validator) │
                                  └─────────────┬─────────────┘
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 │                                                             │
                 ▼                                                             ▼
       POST /b2/upload-authorize                                     POST /b2/download-authorize
  ┌─────────────────────────────────┐                           ┌──────────────────────────────────┐
  │ 1. Verify Firebase JWT          │                           │ 1. Verify Firebase JWT           │
  │ 2. Enforce token is from Project│                           │ 2. Reject Anonymous Tokens (403) │
  │ 3. Enforce vaultId == SERVER_ID │                           │ 3. If Admin: Sign SigV4 GET      │
  │ 4. Rate-limit & validate SHA256 │                           │ 4. If Friend: Check Permissions  │
  │ 5. Sign SigV4 Presigned PUT     │                           │    in Firestore; Sign SigV4 GET  │
  │ 6. Return direct upload URL     │                           │ 5. If Not Permitted: Return 403  │
  └─────────────────────────────────┘                           └──────────────────────────────────┘
```

---

## 5. Granular Viewer Access Control Model

### Deterministic Permission Evaluation Algorithm
When a human user with verified Google UID `callerUid` requests metadata access or download authorization for a file at `relativePath + originalName`:

```text
Step 1: Check Admin
        If callerUid in vaults/{vaultId}/settings.adminUids:
            → ALLOW (Admin has unrestricted access to all files and folders)

Step 2: Check Vault Whitelist
        If callerUid NOT in vaults/{vaultId}/settings.authorizedFriends:
            → DENY (Caller is not an authorized member of this vault)

Step 3: Check Explicit File Permission (Highest Precedence)
        Retrieve vaults/{vaultId}/files/{fileId}
        If file.allowedFriends is non-empty:
            If callerUid in file.allowedFriends:
                → ALLOW
            Else:
                → DENY (Explicit file-level restriction overrides all folder inheritance)
        If file.isPublicToFriends == true:
            → ALLOW (Explicitly marked public to all whitelisted friends)

Step 4: Check Nearest Matching Folder Rule (Inheritance Precedence)
        Find all rules in vaults/{vaultId}/folderRules where rule.relativePath is a prefix of file.relativePath.
        Select the rule with the longest / most specific matching relativePath:
            If callerUid in folderRule.allowedFriends:
                → ALLOW
            Else:
                → DENY

Step 5: Default Fallback
        If no explicit file override and no matching folder rule exists:
            → DENY (Default-deny for unassigned private files)
```

### Precedence Hierarchy:
1. `HUMAN_ADMIN` (Universal access)
2. Explicit `file.allowedFriends` (Specific grant)
3. Explicit `file.isPublicToFriends == true` (Explicit public grant)
4. Nearest / Most Specific `folderRule` (Longest matching prefix)
5. Vault Default Deny

---

## 6. Admin Bootstrap Mechanism

1. **Fixed Server-Side Seeding**: The initial Admin Google UID is declared in the backend environment (`INITIAL_ADMIN_GOOGLE_UID`) and seeded into Firestore `vaults/{vaultId}/settings.adminUids`.
2. **Deterministic Ownership**: The first human account does NOT automatically acquire admin status upon signing in. Only the pre-configured owner Google account is granted `adminUids` membership.
3. **First Login Flow**:
   - User signs in with Google on Web Viewer.
   - Web Viewer passes Firebase Google ID token to backend / Firestore.
   - If `token.uid` matches `adminUids`: Full Admin UI and management capabilities are unlocked.
   - If `token.uid` matches `authorizedFriends`: Viewer UI is displayed with permitted files only.
   - If `token.uid` is unrecognized: Access is denied (`403 Forbidden`).
4. **Post-Bootstrap Delegation**: The Admin can subsequently add co-admins or whitelisted friends via the Web Viewer Admin Console.
