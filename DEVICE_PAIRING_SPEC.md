# Owner-Device Pairing Specification (SUPERSEDED)

> [!WARNING]
> **SUPERSEDED**: The 6-digit claim code pairing architecture has been superseded by the **Shared-Vault Architecture** documented in [ACCESS_CONTROL_SPEC.md](file:///c:/Users/krish/Documents/PROJECTS/USBCloudBackup/ACCESS_CONTROL_SPEC.md) and [FIRESTORE_SCHEMA.md](file:///c:/Users/krish/Documents/PROJECTS/USBCloudBackup/FIRESTORE_SCHEMA.md).
> 
> In the finalized architecture:
> - The Android daemon is an **unattended, headless upload-only agent** using Firebase Anonymous Auth directly.
> - The physical flash drive identity (`sourceId`) is the storage anchor.
> - All files map to `backups/{vaultId}/{sourceId}/...` without requiring manual pairing or owner linking.

## 1. Historical Problem Statement

- **Android Background Daemon**: Runs headlessly on an Android device (e.g. tablet, set-top box, dedicated phone). Initial bootstrap uses Firebase Anonymous Authentication (`anonymousUid`).
- **Web Viewer Owner / Admin**: Signs in via Google Authentication (`ownerGoogleUid`).
- **Core Requirement**: The Android daemon must store and index all backups into `users/{ownerGoogleUid}/` and Backblaze B2 `backups/{ownerGoogleUid}/`, without baking any hardcoded secrets, passwords, or Firebase Admin credentials into the Android APK.

---

## 2. Pairing Architecture Options

```text
┌───────────────────────────┐                      ┌────────────────────────────┐
│   Android Daemon (App)    │                      │   Web Viewer (Browser)     │
│   (Anonymous / Setup)     │                      │   (Owner Google Sign-In)   │
└─────────────┬─────────────┘                      └─────────────┬──────────────┘
              │                                                  │
              │ 1. Request Claim Code                            │
              ├──────────────────────────┐                       │
              │                          │                       │
              ▼                          ▼                       │
       ┌──────────────┐          ┌──────────────┐                │
       │ Local Screen │          │ Firestore    │                │
       │ Code: 849-210│          │ deviceClaims │                │
       └──────────────┘          └───────┬──────┘                │
                                         ▲                       │
                                         │ 2. Owner enters code  │
                                         └───────────────────────┤
                                           status: CLAIMED       │
                                           ownerUid: ownerGoogle │
              │                                                  ▼
              │ 3. Listener / Polling detects CLAIMED
              │    Upgrades Auth / Binds ownerUid
              ▼
    Paired permanently to ownerGoogleUid
```

### Primary Flow: Cryptographic Ephemeral Claim Code Flow
1. **Device Initiation (Setup Wizard or Pairing Screen)**:
   - Android daemon authenticates anonymously (`deviceUid`).
   - Daemon generates an ephemeral 6-digit claim code (e.g. `849-210`) with a SHA-256 device installation token.
   - Daemon creates a document in `deviceClaims/{claimId}` with:
     ```json
     {
       "claimCode": "849210",
       "deviceUid": "anonymous_uid_abc123",
       "deviceFingerprint": "sha256_hash_of_device_install_id",
       "status": "PENDING",
       "createdAt": "TIMESTAMP",
       "expiresAt": "TIMESTAMP (+10 minutes)"
     }
     ```
   - App UI displays: *"Pairing Code: 849-210 (Expires in 10 mins)"*.

2. **Owner Claiming (Web Viewer)**:
   - Owner signs in with Google on Web Viewer (`ownerGoogleUid`).
   - Navigates to **Admin → Pair Android Device**.
   - Enters the 6-digit code `849210`.
   - Web Viewer queries `deviceClaims` where `claimCode == "849210" && status == "PENDING"`.
   - Web Viewer updates the document:
     ```json
     {
       "ownerUid": "ownerGoogleUid",
       "status": "CLAIMED",
       "claimedAt": "TIMESTAMP"
     }
     ```
   - Web Viewer also adds `deviceUid` to `users/{ownerGoogleUid}/profile/settings.pairedDevices`.

3. **Daemon Confirmation & Binding**:
   - Daemon listens to its `deviceClaims/{claimId}` document.
   - Upon transition to `status == "CLAIMED"`, the daemon securely records `ownerUid = ownerGoogleUid` in Android `EncryptedSharedPreferences`.
   - Daemon links its anonymous account with the owner credentials if interactive, or uses the B2 Authorizer gateway with signed device assertion.
   - Deletes the ephemeral `deviceClaims/{claimId}` document.

---

## 3. Alternative Direct Flow: Google Sign-In during Android Setup

For attended installations:
1. User opens `MainActivity` on Android during initial setup.
2. Selects **Sign in with Google**.
3. Android app authenticates directly as `ownerGoogleUid`.
4. Firebase Auth token is automatically persisted in the app sandbox.
5. All subsequent headless background WorkManager executions run under `ownerGoogleUid`.

---

## 4. Security Invariants for Pairing

1. **Short TTL**: Claim codes expire after 10 minutes.
2. **Brute-Force Protection**: 
   - Rate limiting on `deviceClaims` queries (max 5 failed attempts per IP / user per minute).
   - Random 6-digit or 8-character alphanumeric entropy.
3. **No Secrets in APK**: Zero private keys or backend service account secrets stored in the client.
4. **Owner-Only Namespace**: Once paired, the daemon is authorized strictly for `backups/{ownerGoogleUid}/*` and `users/{ownerGoogleUid}/*`.
