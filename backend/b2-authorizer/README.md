# USBCloudBackup — Backblaze B2 Authorization Backend

## Overview

This service is the secure **Backblaze B2 S3 Authorization Backend** for USBCloudBackup. It verifies Google Firebase ID tokens (JWTs) via Google's public JWKS certificates and issues short-lived, scoped AWS SigV4 Presigned PUT/HEAD URLs directly for the **Backblaze B2 S3 endpoint** (`https://s3.eu-central-003.backblazeb2.com`, bucket `BrightCloud`).

---

## Production Configuration Matrix

| Variable / Secret | Type | Location | Purpose | Example / Value |
|---|---|---|---|---|
| `FIREBASE_PROJECT_ID` | Variable | `wrangler.toml` / `.dev.vars` | Verifies JWT audience (`aud`) and issuer (`iss`) | `your-firebase-project-id` |
| `B2_ENDPOINT` | Variable | `wrangler.toml` / `.dev.vars` | Backblaze B2 S3 API Endpoint | `https://s3.eu-central-003.backblazeb2.com` |
| `B2_BUCKET` | Variable | `wrangler.toml` / `.dev.vars` | Target Backblaze B2 private bucket | `BrightCloud` |
| `B2_REGION` | Variable | `wrangler.toml` / `.dev.vars` | Backblaze B2 region identifier | `eu-central-003` |
| `B2_KEY_ID` | **Secret** | Cloudflare / Server Secret Storage | Backblaze Application Key ID (server-side only) | `003...` |
| `B2_APPLICATION_KEY` | **Secret** | Cloudflare / Server Secret Storage | Backblaze Application Key Secret (server-side only) | `K003...` |
| `AUTH_TOKEN_SECRET` | **Secret** (Optional) | Cloudflare / Server Secret Storage | Server-side HMAC token signing | Random 32+ char string |

> [!CAUTION]
> **Zero Client Secrets**: `B2_KEY_ID` and `B2_APPLICATION_KEY` must **NEVER** be committed to Git, embedded in Android source files, added to `BuildConfig`, or pasted into chat.

---

## Production Architecture Flow

```text
Android Client (Authenticated via Firebase Auth)
       │
       │ 1. POST /b2/upload-authorize
       │    Authorization: Bearer <Firebase ID Token>
       │    Body: { objectKey, sha256, sourceId, originalName, fileId }
       ▼
Backblaze B2 Authorizer Backend
       │
       │ 2. Cryptographically verify Firebase JWT using Google JWKS (RS256)
       │ 3. Extract verified UID strictly from 'sub' claim
       │ 4. Validate canonical objectKey format & enforce owner prefix (backups/{verifiedUid}/*)
       │ 5. Reject path traversal (.. / %2e%2e) and null bytes (\0)
       │ 6. Generate AWS SigV4 Presigned PUT URL directly to Backblaze B2:
       │    https://s3.eu-central-003.backblazeb2.com/BrightCloud/<objectKey>?X-Amz-Signature=...
       │    Signs metadata headers: x-amz-meta-sha256, x-amz-meta-source-id,
       │    x-amz-meta-original-name, x-amz-meta-file-id
       ▼
Android Client
       │
       │ 7. Stream raw file bytes directly to Backblaze B2 S3 endpoint
       │    (64 KB bounded streaming chunks, zero whole-file RAM buffering)
       ▼
Backblaze B2 Object Storage (BrightCloud Bucket, Private)
       (Zero RAM buffering, zero whole-file proxying, byte-for-byte fidelity)
```

---

## Deployment & Setup Checklist

Follow these steps to deploy and configure the Backblaze B2 Authorizer backend:

### Step 1: Local Development Setup
1. Copy the environment template:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
2. Open `.dev.vars` in your local text editor and fill in your real credentials:
   - Set `FIREBASE_PROJECT_ID` to your Firebase project ID.
   - Set `B2_KEY_ID` to your Backblaze B2 Application Key ID.
   - Set `B2_APPLICATION_KEY` to your Backblaze B2 Application Key secret.
3. Test locally using Wrangler:
   ```bash
   npx wrangler dev
   ```

### Step 2: Production Cloudflare Deployment
1. Set the production secrets in Cloudflare Worker storage via CLI:
   ```bash
   npx wrangler secret put B2_KEY_ID
   # When prompted, paste your real Backblaze Key ID

   npx wrangler secret put B2_APPLICATION_KEY
   # When prompted, paste your real Backblaze Application Key secret
   ```
2. Update `wrangler.toml` if needed:
   - Ensure `FIREBASE_PROJECT_ID` matches your production Firebase project.
   - Verify `B2_ENDPOINT = "https://s3.eu-central-003.backblazeb2.com"` and `B2_BUCKET = "BrightCloud"`.
3. Deploy the worker:
   ```bash
   npx wrangler deploy
   ```

### Step 3: Android App Pointing
- Set the authorizer URL in the Android app configuration or via `DefaultB2AuthorizationProvider(backendBaseUrl = "https://<your-worker-subdomain>.workers.dev")`.

---

## Automated Verification

Run all automated test suites:
```bash
node --experimental-strip-types backend/b2-authorizer/test/run-all-tests.mjs
```
