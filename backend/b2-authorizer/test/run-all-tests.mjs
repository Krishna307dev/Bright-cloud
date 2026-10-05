import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { verifyFirebaseToken, AuthenticationError } from "../src/auth.ts";
import {
  validateObjectKey,
  validateUploadRequest,
  validateDownloadRequest,
  isAuthorizedToDownload,
  ValidationError,
  CrossVaultAccessError
} from "../src/validator.ts";
import {
  generateUploadAuthorization,
  generateHeadAuthorization,
  generateDownloadAuthorization,
  AuthorizationError
} from "../src/authorizer.ts";
import { createB2PresignedUrl } from "../src/sigv4.ts";
import { generateTestKeyPair, createSignedTestFirebaseToken } from "./jwt-helper.ts";
import { checkRateLimit, resetRateLimitsForTesting, RateLimitExceededError } from "../src/rateLimiter.ts";

test("Backblaze B2 Authorizer Shared Vault Test Suite", async (t) => {
  const projectId = "usbcloudbackup-test";
  const defaultVaultId = "default";
  const keyPair = await generateTestKeyPair("b2-runner-key-1");
  const otherKeyPair = await generateTestKeyPair("b2-runner-key-other");
  const validSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  // Section A: Authentication Tests
  await t.test("Auth 1: Valid Firebase ID token passes signature & claim checks", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "verified_alice",
        exp: now + 3600,
        auth_time: now - 10,
        email: "alice@example.com"
      },
      keyPair
    );

    const verified = await verifyFirebaseToken(`Bearer ${token}`, projectId, [keyPair.publicKeyJwk]);
    assert.equal(verified.uid, "verified_alice");
    assert.equal(verified.aud, projectId);
  });

  await t.test("Auth 2: Missing Authorization header throws 401 AuthenticationError", async () => {
    await assert.rejects(
      async () => verifyFirebaseToken(null, projectId, [keyPair.publicKeyJwk]),
      AuthenticationError
    );
  });

  await t.test("Auth 3: Malformed token format throws AuthenticationError", async () => {
    await assert.rejects(
      async () => verifyFirebaseToken("Bearer not.valid", projectId, [keyPair.publicKeyJwk]),
      /Malformed JWT/
    );
  });

  await t.test("Auth 4: Expired token throws AuthenticationError", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "user_123",
        exp: now - 30,
        auth_time: now - 3600
      },
      keyPair
    );

    await assert.rejects(
      async () => verifyFirebaseToken(`Bearer ${token}`, projectId, [keyPair.publicKeyJwk]),
      /Token has expired/
    );
  });

  await t.test("Auth 5: Wrong audience throws AuthenticationError", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/wrong-app`,
        aud: "wrong-app",
        sub: "user_123",
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    await assert.rejects(
      async () => verifyFirebaseToken(`Bearer ${token}`, projectId, [keyPair.publicKeyJwk]),
      /Invalid token issuer/
    );
  });

  await t.test("Auth 6: Unrecognized key signature throws AuthenticationError", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "user_123",
        exp: now + 3600,
        auth_time: now
      },
      otherKeyPair
    );

    await assert.rejects(
      async () => verifyFirebaseToken(`Bearer ${token}`, projectId, [keyPair.publicKeyJwk]),
      /No matching public key/
    );
  });

  // Section B: Object Key Validation & Security Tests
  await t.test("Security 1: Accepts valid vault-scoped canonical key", () => {
    const parsed = validateObjectKey("backups/default/src1/Notes/Math/doc.pdf", defaultVaultId);
    assert.equal(parsed.vaultId, "default");
    assert.equal(parsed.sourceId, "src1");
    assert.equal(parsed.relativePath, "Notes/Math/");
    assert.equal(parsed.storedName, "doc.pdf");
  });

  await t.test("Security 2: Rejects cross-vault key request", () => {
    assert.throws(
      () => validateObjectKey("backups/other-vault/src1/secret.pdf", defaultVaultId),
      CrossVaultAccessError
    );
  });

  await t.test("Security 3: Rejects path traversal (literal ../)", () => {
    assert.throws(
      () => validateObjectKey("backups/default/../../victim/data.txt", defaultVaultId),
      ValidationError
    );
  });

  await t.test("Security 4: Rejects path traversal (URL-encoded %2e%2e)", () => {
    assert.throws(
      () => validateObjectKey("backups/default/%2e%2e/victim/data.txt", defaultVaultId),
      ValidationError
    );
  });

  await t.test("Security 5: Rejects null byte injection in key", () => {
    assert.throws(
      () => validateObjectKey("backups/default/src1/\0file.pdf", defaultVaultId),
      ValidationError
    );
  });

  await t.test("Security 6: Rejects empty or non-prefixed key", () => {
    assert.throws(() => validateObjectKey("", defaultVaultId), ValidationError);
    assert.throws(() => validateObjectKey("other_prefix/default/src1/file.pdf", defaultVaultId), ValidationError);
  });

  // Section C: Metadata Validation Tests
  await t.test("Metadata 1: Accepts valid upload request payload", () => {
    assert.doesNotThrow(() =>
      validateUploadRequest(
        {
          objectKey: "backups/default/src1/image.png",
          sha256: validSha256,
          sourceId: "src1",
          originalName: "image.png",
          fileId: "1001"
        },
        defaultVaultId
      )
    );
  });

  await t.test("Metadata 2: Rejects non-hex or non-64-character SHA-256", () => {
    assert.throws(
      () =>
        validateUploadRequest(
          {
            objectKey: "backups/default/src1/image.png",
            sha256: "INVALID_SHA_UPPERCASE",
            sourceId: "src1",
            originalName: "image.png",
            fileId: "1001"
          },
          defaultVaultId
        ),
      ValidationError
    );
  });

  await t.test("Metadata 3: Rejects missing required metadata fields", () => {
    assert.throws(
      () =>
        validateUploadRequest(
          {
            objectKey: "backups/default/src1/image.png",
            sha256: validSha256,
            sourceId: "",
            originalName: "image.png",
            fileId: "1001"
          },
          defaultVaultId
        ),
      ValidationError
    );
  });

  // Section D: Rate Limiter Tests
  await t.test("RateLimiter 1: Limits excess requests from single user", () => {
    resetRateLimitsForTesting();
    for (let i = 0; i < 120; i++) {
      checkRateLimit("spammer_uid");
    }
    assert.throws(() => checkRateLimit("spammer_uid"), RateLimitExceededError);
  });

  await t.test("RateLimiter 2: Supports Cloudflare Rate Limiter binding", async () => {
    let limited = false;
    const mockBinding = {
      limit: async ({ key }) => {
        if (limited) return { success: false };
        return { success: true };
      }
    };

    // First call succeeds
    await assert.doesNotReject(async () => {
      await checkRateLimit("user_dist", { RATE_LIMITER: mockBinding });
    });

    limited = true;
    // Second call exceeds
    await assert.rejects(async () => {
      await checkRateLimit("user_dist", { RATE_LIMITER: mockBinding });
    }, RateLimitExceededError);
  });


  // Section E: Backblaze B2 S3 AWS SigV4 Direct Presigning Tests
  await t.test("SigV4 1: Generates valid AWS4-HMAC-SHA256 presigned URL for Backblaze B2", async () => {
    const b2Config = {
      endpoint: "https://s3.eu-central-003.backblazeb2.com",
      keyId: "b2_key_id_abc",
      applicationKey: "b2_app_sec_xyz_123456789",
      bucketName: "BrightCloud",
      region: "eu-central-003"
    };

    const headers = {
      "x-amz-meta-sha256": validSha256,
      "x-amz-meta-source-id": "src1",
      "x-amz-meta-original-name": "large_file.zip",
      "x-amz-meta-file-id": "999"
    };

    const presignedUrl = await createB2PresignedUrl(b2Config, {
      method: "PUT",
      objectKey: "backups/default/src1/large_file.zip",
      expiresInSeconds: 3600,
      headers
    });

    const parsed = new URL(presignedUrl);
    assert.equal(parsed.hostname, "s3.eu-central-003.backblazeb2.com");
    assert.ok(parsed.pathname.includes("BrightCloud"));
    assert.ok(parsed.pathname.includes("large_file.zip"));
    assert.equal(parsed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.ok(parsed.searchParams.get("X-Amz-Credential").includes("b2_key_id_abc"));
    assert.ok(parsed.searchParams.get("X-Amz-Credential").includes("eu-central-003/s3/aws4_request"));
    assert.ok(parsed.searchParams.get("X-Amz-SignedHeaders").includes("x-amz-meta-sha256"));
    assert.ok(parsed.searchParams.get("X-Amz-Signature"));
    assert.equal(parsed.searchParams.get("X-Amz-Signature").length, 64);
  });

  await t.test("SigV4 2: Authorizer generates DIRECT_PRESIGNED_PUT with Backblaze B2 endpoint", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "b2_key_direct",
      B2_APPLICATION_KEY: "b2_app_secret_direct"
    };

    const auth = await generateUploadAuthorization(
      {
        objectKey: "backups/default/src1/video.mp4",
        sha256: validSha256,
        sourceId: "src1",
        originalName: "video.mp4",
        fileId: "5001"
      },
      "anonymous_daemon_uid",
      env
    );

    assert.equal(auth.uploadMode, "DIRECT_PRESIGNED_PUT");
    assert.ok(auth.uploadUrl.startsWith("https://s3.eu-central-003.backblazeb2.com/BrightCloud/"));
    assert.ok(auth.uploadUrl.includes("X-Amz-Signature="));
    assert.equal(auth.headers["x-amz-meta-sha256"], validSha256);
    // Verify Android daemon presigned PUT signs all x-amz-meta-* headers to satisfy Backblaze B2 SigV4
    const urlObj = new URL(auth.uploadUrl);
    const signedHeaders = urlObj.searchParams.get("X-Amz-SignedHeaders");
    assert.ok(signedHeaders, "X-Amz-SignedHeaders must be present");
    assert.ok(signedHeaders.includes("x-amz-meta-sha256"), "SignedHeaders must contain x-amz-meta-sha256");
    assert.ok(signedHeaders.includes("x-amz-meta-source-id"), "SignedHeaders must contain x-amz-meta-source-id");
    assert.ok(signedHeaders.includes("x-amz-meta-original-name"), "SignedHeaders must contain x-amz-meta-original-name");
    assert.ok(signedHeaders.includes("x-amz-meta-file-id"), "SignedHeaders must contain x-amz-meta-file-id");
  });

  await t.test("SigV4 3: Web uploads keep X-Amz-SignedHeaders host-only to prevent browser CORS preflight failure", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "b2_key_web",
      B2_APPLICATION_KEY: "b2_app_secret_web"
    };

    const auth = await generateUploadAuthorization(
      {
        objectKey: "backups/default/WEB_UPLOADS/document.pdf",
        sha256: validSha256,
        sourceId: "WEB_UPLOADS",
        originalName: "document.pdf",
        fileId: "6001"
      },
      "verified_web_user",
      env
    );

    assert.equal(auth.uploadMode, "DIRECT_PRESIGNED_PUT");
    assert.ok(auth.uploadUrl.includes("X-Amz-Signature="));
    const urlObj = new URL(auth.uploadUrl);
    const signedHeaders = urlObj.searchParams.get("X-Amz-SignedHeaders");
    assert.equal(signedHeaders, "host", "Web upload signed headers must only be host to preserve browser CORS");
  });

  // Section F: Direct HEAD Authorization Tests
  await t.test("HeadAuth 1: Generates direct presigned HEAD URL for Backblaze B2 object recovery", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "b2_key_123",
      B2_APPLICATION_KEY: "b2_sec_xyz"
    };

    const headAuth = await generateHeadAuthorization(
      "backups/default/src1/file.pdf",
      "anonymous_daemon_uid",
      env
    );

    assert.ok(headAuth.headUrl.startsWith("https://s3.eu-central-003.backblazeb2.com/BrightCloud/"));
    assert.ok(headAuth.headUrl.includes("X-Amz-Signature="));
  });

  // Section G: Full Worker HTTP API Tests
  await t.test("Worker API 1: GET /health returns Backblaze B2 status", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_BUCKET: "BrightCloud"
    };
    const res = await worker.fetch(new Request("https://b2-auth.local/health"), env, {});
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "healthy");
    assert.equal(json.storageProvider, "Backblaze B2");
    assert.equal(json.vaultId, defaultVaultId);
    assert.equal(json.bucket, "BrightCloud");
  });

  await t.test("Worker API 2: Authorize endpoint returns Direct Presigned B2 S3 URL for Anonymous Daemon", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    globalThis.fetch = async (input) => {
      if (input.toString().includes("securetoken@system.gserviceaccount.com")) {
        return new Response(JSON.stringify({ keys: [keyPair.publicKeyJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "anon_daemon_device_1",
        firebase: { sign_in_provider: "anonymous" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    // 1. Authorize Upload
    const authRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/upload-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          objectKey: "backups/default/src1/archive.zip",
          sha256: validSha256,
          sourceId: "src1",
          originalName: "archive.zip",
          fileId: "888"
        })
      }),
      env,
      {}
    );
    assert.equal(authRes.status, 200);
    const authJson = await authRes.json();
    assert.equal(authJson.uploadMode, "DIRECT_PRESIGNED_PUT");
    assert.ok(authJson.uploadUrl.startsWith("https://s3.eu-central-003.backblazeb2.com/BrightCloud/"));
    assert.ok(authJson.uploadUrl.includes("X-Amz-Signature="));
    assert.equal(authJson.headers["x-amz-meta-sha256"], validSha256);
  });

  await t.test("Worker API 3: Raw-byte upload proxying is strictly disabled (returns 410 Gone)", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId
    };

    const uploadRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/upload/backups/default/src/file.pdf", {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream"
        },
        body: new Uint8Array([1, 2, 3])
      }),
      env,
      {}
    );
    assert.equal(uploadRes.status, 410);
    const json = await uploadRes.json();
    assert.ok(json.message.includes("Direct Presigned S3 Upload to Backblaze B2 is required"));
  });

  // Section H: B2 Download Authorization & Access Control Tests (FileId-based)
  await t.test("DownloadAuth 1: Anonymous daemon CANNOT download (403 Forbidden)", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const anonToken = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "anon_daemon_uid",
        firebase: { sign_in_provider: "anonymous" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const downloadRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${anonToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-doc-123"
        })
      }),
      env,
      {}
    );

    assert.equal(downloadRes.status, 403);
    const json = await downloadRes.json();
    assert.equal(json.error, "Forbidden");
  });

  // Setup mock Firestore file store for subsequent tests
  const mockFiles = {
    "file-public": {
      isPublicToFriends: true,
      allowedFriends: [],
      b2ObjectKey: "backups/default/src1/public_doc.pdf",
      storedName: "public_doc.pdf"
    },
    "file-shared-bob": {
      isPublicToFriends: false,
      allowedFriends: ["friend_bob"],
      b2ObjectKey: "backups/default/src1/bob_doc.pdf",
      storedName: "bob_doc.pdf"
    },
    "file-private": {
      isPublicToFriends: false,
      allowedFriends: ["other_user"],
      b2ObjectKey: "backups/default/src1/private_doc.pdf",
      storedName: "private_doc.pdf"
    }
  };

  function setupMockFirestoreFetch(adminUid = "google_admin_uid_1") {
    globalThis.fetch = async (input, init) => {
      const url = input.toString();
      if (url.includes("securetoken@system.gserviceaccount.com")) {
        return new Response(JSON.stringify({ keys: [keyPair.publicKeyJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Firestore document read
      const match = url.match(/\/documents\/vaults\/([^/]+)\/files\/([^/]+)$/);
      if (match) {
        const [, vaultId, fileId] = match;
        const authHeader = init?.headers?.["Authorization"] || init?.headers?.authorization;
        const file = mockFiles[fileId];

        if (!file) {
          return new Response(JSON.stringify({ error: { code: 404, message: "Document not found" } }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
          });
        }

        // Simulate Firestore security rules:
        // allow read: if isAdmin() || (isFriend() && (resource.data.isPublicToFriends == true || request.auth.uid in resource.data.allowedFriends));
        let callerUid = null;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          try {
            const token = authHeader.substring(7);
            const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
            callerUid = payload.sub;
          } catch (_) {}
        }

        const isAdmin = callerUid === adminUid;
        const isPublic = file.isPublicToFriends;
        const isAllowedFriend = callerUid && file.allowedFriends.includes(callerUid);

        if (isAdmin || isPublic || isAllowedFriend) {
          return new Response(
            JSON.stringify({
              fields: {
                b2ObjectKey: { stringValue: file.b2ObjectKey },
                storedName: { stringValue: file.storedName }
              }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } else {
          return new Response(JSON.stringify({ error: { code: 403, message: "Permission denied" } }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      return new Response("Not Found", { status: 404 });
    };
  }

  await t.test("DownloadAuth 2: Google Admin can request download authorization for valid fileId", async () => {
    setupMockFirestoreFetch("google_admin_uid_1");
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const adminToken = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "google_admin_uid_1",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const downloadRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-private"
        })
      }),
      env,
      {}
    );

    assert.equal(downloadRes.status, 200);
    const json = await downloadRes.json();
    assert.ok(json.downloadUrl.startsWith("https://s3.eu-central-003.backblazeb2.com/BrightCloud/"));
    assert.ok(json.downloadUrl.includes("X-Amz-Signature="));
    assert.equal(json.fileId, "file-private");
    assert.equal(json.storedName, "private_doc.pdf");
    assert.ok(json.expiresAt > Date.now());
  });

  await t.test("DownloadAuth 3: Public friend file can be authorized for friend", async () => {
    setupMockFirestoreFetch();
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const friendToken = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "friend_charlie",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const downloadRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${friendToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-public"
        })
      }),
      env,
      {}
    );

    assert.equal(downloadRes.status, 200);
    const json = await downloadRes.json();
    assert.equal(json.fileId, "file-public");
    assert.ok(json.downloadUrl.includes("X-Amz-Signature="));
  });

  await t.test("DownloadAuth 4: Friend in allowedFriends can download targeted file", async () => {
    setupMockFirestoreFetch();
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const bobToken = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "friend_bob",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const downloadRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-shared-bob"
        })
      }),
      env,
      {}
    );

    assert.equal(downloadRes.status, 200);
    const json = await downloadRes.json();
    assert.equal(json.fileId, "file-shared-bob");
  });

  await t.test("DownloadAuth 5: Private unallowed file returns 403 to non-allowed friend", async () => {
    setupMockFirestoreFetch();
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const unallowedToken = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "unauthorized_eve",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const downloadRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${unallowedToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-private"
        })
      }),
      env,
      {}
    );

    assert.equal(downloadRes.status, 403);
  });

  await t.test("DownloadAuth 6: Friend allowed for File A requesting private File B gets 403", async () => {
    setupMockFirestoreFetch();
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const bobToken = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "friend_bob",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    // Bob tries to access file-private
    const downloadRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-private"
        })
      }),
      env,
      {}
    );

    assert.equal(downloadRes.status, 403);
  });

  await t.test("DownloadAuth 7: Arbitrary objectKey in request cannot bypass fileId authorization", async () => {
    setupMockFirestoreFetch();
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const bobToken = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "friend_bob",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    // Bob requests file-shared-bob but sends malicious objectKey pointing to private file
    const downloadRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-shared-bob",
          objectKey: "backups/default/src1/private_doc.pdf"
        })
      }),
      env,
      {}
    );

    assert.equal(downloadRes.status, 200);
    const json = await downloadRes.json();
    // Verify the returned downloadUrl is for bob_doc.pdf, NOT the injected objectKey
    assert.ok(decodeURIComponent(json.downloadUrl).includes("bob_doc.pdf"));
    assert.ok(!decodeURIComponent(json.downloadUrl).includes("private_doc.pdf"));
  });

  await t.test("DownloadAuth 8: Cross-vault request gets 403 Forbidden", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "user_a",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const res = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-public",
          vaultId: "another_vault"
        })
      }),
      env,
      {}
    );

    assert.equal(res.status, 403);
  });

  await t.test("DownloadAuth 9: Missing file in Firestore returns 403/404 Access Denied", async () => {
    setupMockFirestoreFetch();
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "google_admin_uid_1",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const res = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "nonexistent-file-id"
        })
      }),
      env,
      {}
    );

    assert.equal(res.status, 403);
  });

  await t.test("DownloadAuth 10: Path traversal in fileId is rejected with 400", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "admin_user",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const res1 = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "../victim/data.txt"
        })
      }),
      env,
      {}
    );
    assert.equal(res1.status, 400);

    const res2 = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "folder/file.pdf"
        })
      }),
      env,
      {}
    );
    assert.equal(res2.status, 400);
  });

  await t.test("DownloadAuth 11: Attachment request URL contains response-content-disposition in signed query; inline request does not", async () => {
    setupMockFirestoreFetch();
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "google_admin_uid_1",
        firebase: { sign_in_provider: "google.com" },
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    // 1. Attachment request with custom filename containing quotes & path separators to sanitize
    const attachRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-public",
          disposition: "attachment",
          filename: 'report"2026/test\\file.pdf'
        })
      }),
      env,
      {}
    );

    assert.equal(attachRes.status, 200);
    const attachJson = await attachRes.json();
    const attachUrl = new URL(attachJson.downloadUrl);
    const dispositionParam = attachUrl.searchParams.get("response-content-disposition");
    assert.ok(dispositionParam, "Attachment URL must contain response-content-disposition query parameter");
    assert.ok(dispositionParam.startsWith("attachment;"));
    assert.ok(dispositionParam.includes('filename="report2026testfile.pdf"'));
    assert.ok(dispositionParam.includes("filename*=UTF-8''report2026testfile.pdf"));
    assert.ok(attachUrl.searchParams.get("X-Amz-Signature"), "Signature must be present");

    // 2. Inline request (or missing disposition) must NOT have response-content-disposition
    const inlineRes = await worker.fetch(
      new Request("https://b2-auth.local/b2/download-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileId: "file-public",
          disposition: "inline"
        })
      }),
      env,
      {}
    );

    assert.equal(inlineRes.status, 200);
    const inlineJson = await inlineRes.json();
    const inlineUrl = new URL(inlineJson.downloadUrl);
    assert.equal(inlineUrl.searchParams.get("response-content-disposition"), null, "Inline URL must not have response-content-disposition");

    // 3. Direct generateDownloadAuthorization check
    const directAttachAuth = await generateDownloadAuthorization(
      "backups/default/src1/test.pdf",
      "google_admin_uid_1",
      env,
      3600,
      { disposition: "attachment", filename: "my-download.pdf" }
    );
    const directUrl = new URL(directAttachAuth.downloadUrl);
    assert.ok(directUrl.searchParams.get("response-content-disposition")?.includes("my-download.pdf"));

    const directInlineAuth = await generateDownloadAuthorization(
      "backups/default/src1/test.pdf",
      "google_admin_uid_1",
      env,
      3600
    );
    const directInlineUrl = new URL(directInlineAuth.downloadUrl);
    assert.equal(directInlineUrl.searchParams.get("response-content-disposition"), null);
  });



  await t.test("DeleteAuth 1: Successfully generates presigned DELETE authorization for cleanup", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_KEY_ID: "dev-key-id",
      B2_APPLICATION_KEY: "dev-app-key-1234567890abcdef",
      B2_BUCKET: "BrightCloud",
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_REGION: "eu-central-003"
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "user_delete_test",
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const res = await worker.fetch(
      new Request("https://b2-auth.local/b2/delete-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          objectKey: "backups/default/src1/redundant_file(1).pdf"
        })
      }),
      env,
      {}
    );

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.deleteUrl, "Should return deleteUrl");
    assert.ok(decodeURIComponent(data.deleteUrl).includes("backups/default/src1/redundant_file(1).pdf"));
    assert.ok(data.deleteUrl.includes("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
    assert.ok(data.expiresAt > Date.now());
  });

  await t.test("DeleteAuth 2: Rejects cross-vault delete request", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "user_delete_test",
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const res = await worker.fetch(
      new Request("https://b2-auth.local/b2/delete-authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          objectKey: "backups/other_vault/src1/file.pdf"
        })
      }),
      env,
      {}
    );

    assert.equal(res.status, 403);
  });

  // Section J: B2 Move Object Tests
  await t.test("MoveObject 1: Accepts valid move-object request", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      B2_BUCKET: "BrightCloud",
      B2_REGION: "eu-central-003",
      B2_KEY_ID: "key_b2_prod",
      B2_APPLICATION_KEY: "secret_b2_prod"
    };

    globalThis.fetch = async (input, init) => {
      const url = input.toString();
      if (url.includes("securetoken@system.gserviceaccount.com")) {
        return new Response(JSON.stringify({ keys: [keyPair.publicKeyJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      // S3 presigned copy or delete simulation
      return new Response(null, { status: 200 });
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "admin_move_test",
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const res = await worker.fetch(
      new Request("https://b2-auth.local/b2/move-object", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceObjectKey: "backups/default/src1/photo.jpg",
          destinationObjectKey: "backups/default/src1/Vacation/photo.jpg"
        })
      }),
      env,
      {}
    );

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.sourceObjectKey, "backups/default/src1/photo.jpg");
    assert.equal(data.destinationObjectKey, "backups/default/src1/Vacation/photo.jpg");
  });

  await t.test("MoveObject 2: Rejects cross-vault move-object request", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "admin_move_test",
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const res = await worker.fetch(
      new Request("https://b2-auth.local/b2/move-object", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceObjectKey: "backups/default/src1/photo.jpg",
          destinationObjectKey: "backups/other_vault/src1/Vacation/photo.jpg"
        })
      }),
      env,
      {}
    );

    assert.equal(res.status, 403);
  });

  await t.test("DeleteDrive 1: Accepts valid drive deletion request and executes prefix purge", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId,
      B2_KEY_ID: "dev-key-id",
      B2_APPLICATION_KEY: "dev-app-key-1234567890abcdef",
      B2_BUCKET: "BrightCloud",
      B2_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com"
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "admin_purge_test",
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    const res = await worker.fetch(
      new Request("https://b2-auth.local/b2/delete-drive", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          vaultId: defaultVaultId,
          sourceId: "src1"
        })
      }),
      env,
      {}
    );

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.prefix, "backups/default/src1/");
  });

  await t.test("DeleteDrive 2: Rejects cross-vault or path traversal drive deletion request", async () => {
    const env = {
      FIREBASE_PROJECT_ID: projectId,
      VAULT_ID: defaultVaultId
    };

    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedTestFirebaseToken(
      {
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        sub: "admin_purge_test",
        exp: now + 3600,
        auth_time: now
      },
      keyPair
    );

    // Cross-vault attempt
    const res1 = await worker.fetch(
      new Request("https://b2-auth.local/b2/delete-drive", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          vaultId: "other_vault",
          sourceId: "src1"
        })
      }),
      env,
      {}
    );
    assert.equal(res1.status, 403);

    // Path traversal attempt in sourceId
    const res2 = await worker.fetch(
      new Request("https://b2-auth.local/b2/delete-drive", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          vaultId: defaultVaultId,
          sourceId: "../escaped"
        })
      }),
      env,
      {}
    );
    assert.equal(res2.status, 400);
  });
});

