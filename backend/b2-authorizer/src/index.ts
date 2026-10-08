import type {
  Env,
  UploadAuthorizeRequest,
  HeadAuthorizeRequest,
  DownloadAuthorizeRequest
} from "./types.ts";
import { verifyFirebaseToken, AuthenticationError } from "./auth.ts";
import {
  validateUploadRequest,
  validateObjectKey,
  validateDrivePrefix,
  validateDownloadRequest,
  isAuthorizedToDownload,
  ValidationError,
  CrossVaultAccessError,
  CrossOwnerAccessError
} from "./validator.ts";
import {
  generateUploadAuthorization,
  generateHeadAuthorization,
  generateDownloadAuthorization,
  generateDeleteAuthorization,
  executeDirectB2Delete,
  executePurgePrefixInB2,
  executePurgeVaultInB2,
  moveObjectInB2,
  copyObjectInB2,
  AuthorizationError
} from "./authorizer.ts";
import { createB2PresignedUrl } from "./sigv4.ts";
import { checkRateLimit, RateLimitExceededError } from "./rateLimiter.ts";

interface RegisteredUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  registeredAt: number;
}
const pendingUsersMap = new Map<string, RegisteredUser>();

async function persistPendingUsersToB2(vaultId: string, env: Env): Promise<void> {
  try {
    const endpoint = env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com";
    const bucketName = env.B2_BUCKET || "BrightCloud";
    const region = env.B2_REGION || "eu-central-003";
    const keyId = env.B2_KEY_ID || "dev-b2-key-id";
    const applicationKey = env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef";

    const objectKey = `backups/${vaultId}/_system/pending_users.json`;
    const putUrl = await createB2PresignedUrl(
      { endpoint, keyId, applicationKey, bucketName, region },
      {
        method: "PUT",
        objectKey,
        expiresInSeconds: 300,
        headers: { "Content-Type": "application/json" }
      }
    );

    const data = JSON.stringify(Array.from(pendingUsersMap.values()), null, 2);
    await fetch(putUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(new TextEncoder().encode(data).length)
      },
      body: data
    });
  } catch (err) {
    console.warn("Failed to persist pending users to B2:", err);
  }
}

async function loadPendingUsersFromB2(vaultId: string, env: Env): Promise<void> {
  try {
    const endpoint = env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com";
    const bucketName = env.B2_BUCKET || "BrightCloud";
    const region = env.B2_REGION || "eu-central-003";
    const keyId = env.B2_KEY_ID || "dev-b2-key-id";
    const applicationKey = env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef";

    const objectKey = `backups/${vaultId}/_system/pending_users.json`;
    const getUrl = await createB2PresignedUrl(
      { endpoint, keyId, applicationKey, bucketName, region },
      {
        method: "GET",
        objectKey,
        expiresInSeconds: 300
      }
    );

    const res = await fetch(getUrl, { method: "GET" });
    if (res.ok) {
      const users = (await res.json()) as RegisteredUser[];
      if (Array.isArray(users)) {
        for (const u of users) {
          if (u.uid && !pendingUsersMap.has(u.uid)) {
            pendingUsersMap.set(u.uid, u);
          }
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load pending users from B2:", err);
  }
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-upload-url, x-download-url, x-amz-meta-source-id, x-amz-meta-file-id, x-amz-meta-original-name, x-amz-meta-sha256, *",
      ...extraHeaders
    }
  });
}

function errorResponse(status: number, error: string, message: string): Response {
  return jsonResponse({ error, message }, status);
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+/g, "/");
    const method = request.method;
    const projectId = env.FIREBASE_PROJECT_ID || "usbcloudbackup-placeholder";
    const serverVaultId = env.VAULT_ID || "default";

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, x-upload-url, x-download-url, x-amz-meta-source-id, x-amz-meta-file-id, x-amz-meta-original-name, x-amz-meta-sha256, *",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    try {
      // 1. Health check
      if (path === "/health" || path === "/") {
        return jsonResponse({
          status: "healthy",
          service: "usbcloudbackup-b2-authorizer",
          storageProvider: "Backblaze B2",
          vaultId: serverVaultId,
          bucket: env.B2_BUCKET || "BrightCloud"
        });
      }

      // 2. Request scoped upload authorization for Backblaze B2 S3 (Anonymous Daemon & Admin)
      if (method === "POST" && (path === "/b2/upload-authorize" || path === "/upload-authorize")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json()) as UploadAuthorizeRequest;
        const parsed = validateUploadRequest(body, serverVaultId);

        const authorization = await generateUploadAuthorization(
          body,
          verifiedToken.uid,
          env
        );

        return jsonResponse(authorization);
      }

      // 3. Request scoped HEAD authorization for Backblaze B2 S3
      if (method === "POST" && (path === "/b2/head-authorize" || path === "/head-authorize")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json()) as HeadAuthorizeRequest;
        const parsed = validateObjectKey(body.objectKey, serverVaultId);

        const authorization = await generateHeadAuthorization(
          body.objectKey,
          verifiedToken.uid,
          env
        );

        return jsonResponse(authorization);
      }

      // 4. Request scoped download/GET authorization for Backblaze B2 S3 (Admin + Authorized Friends ONLY)
      if (method === "POST" && (path === "/b2/download-authorize" || path === "/download-authorize")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json()) as DownloadAuthorizeRequest;
        const parsed = validateDownloadRequest(body, serverVaultId);

        const authResult = await isAuthorizedToDownload(
          parsed.vaultId,
          verifiedToken,
          parsed.fileId,
          env,
          authHeader || undefined
        );

        if (!authResult) {
          throw new CrossVaultAccessError(
            `Download access denied: caller '${verifiedToken.uid}' is not authorized to download file '${parsed.fileId}' from vault '${parsed.vaultId}'`
          );
        }

        const effectiveFilename = authResult.originalName || body.filename || authResult.storedName || "download";

        const authorization = await generateDownloadAuthorization(
          authResult.b2ObjectKey,
          verifiedToken.uid,
          env,
          3600,
          {
            disposition: body.disposition,
            filename: effectiveFilename
          }
        );

        return jsonResponse({
          downloadUrl: authorization.downloadUrl,
          expiresAt: authorization.expiresAt,
          fileId: parsed.fileId,
          storedName: authResult.storedName,
          headers: authorization.headers
        });
      }

      // 5. Request scoped DELETE authorization for Backblaze B2 S3 (Redundant upload cleanup)
      if (method === "POST" && (path === "/b2/delete-authorize" || path === "/delete-authorize")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json()) as { objectKey: string };
        const parsed = validateObjectKey(body.objectKey, serverVaultId);

        const authorization = await generateDeleteAuthorization(
          body.objectKey,
          verifiedToken.uid,
          env
        );

        return jsonResponse(authorization);
      }

      // 5.1 Execute direct DELETE in Backblaze B2 S3 (Server-side execution to bypass browser CORS)
      if (method === "POST" && (path === "/b2/delete-object" || path === "/delete-object")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json()) as { objectKey: string };
        if (!body.objectKey) {
          throw new ValidationError("Missing required objectKey");
        }
        validateObjectKey(body.objectKey, serverVaultId);

        const result = await executeDirectB2Delete(body.objectKey, env);
        return jsonResponse(result);
      }

      // 5.2 Execute drive prefix purge in Backblaze B2 (Permanent deletion of an entire hardware source drive)
      if (method === "POST" && (path === "/b2/delete-drive" || path === "/delete-drive")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json()) as { vaultId: string; sourceId: string };
        const prefix = validateDrivePrefix(body.vaultId, body.sourceId, serverVaultId);

        const result = await executePurgePrefixInB2(prefix, env);
        return jsonResponse(result);
      }

      // 5.3 Execute vault-wide purge in Backblaze B2 (Permanent deletion of all files in vault while preserving system files)
      if (method === "POST" && (path === "/b2/wipe-vault" || path === "/wipe-vault")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json().catch(() => ({}))) as { vaultId?: string };
        const reqVaultId = body?.vaultId || serverVaultId;
        if (reqVaultId !== serverVaultId) {
          throw new CrossVaultAccessError(`Cross-vault wipe rejected: '${reqVaultId}' !== '${serverVaultId}'`);
        }

        const result = await executePurgeVaultInB2(reqVaultId, env);
        return jsonResponse(result);
      }

      // 5.5 Raw-byte upload proxying is strictly disabled (returns 410 Gone)
      if (method === "PUT" && path.startsWith("/b2/upload/")) {
        return errorResponse(410, "Gone", "Direct Presigned S3 Upload to Backblaze B2 is required");
      }

      // 6. Streaming upload proxy fallback for browser CORS resilience
      if (method === "PUT" && (path === "/b2/upload-proxy" || path === "/upload-proxy")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const targetUploadUrl = request.headers.get("x-upload-url") || url.searchParams.get("uploadUrl");
        if (!targetUploadUrl) {
          throw new ValidationError("Missing required target 'x-upload-url' header");
        }

        // Validate that targetUploadUrl points to a trusted Backblaze B2 S3 endpoint
        const targetUrlObj = new URL(targetUploadUrl);
        const isB2Host =
          targetUrlObj.hostname.endsWith(".backblazeb2.com") ||
          targetUrlObj.hostname.includes("backblaze") ||
          targetUrlObj.hostname === "localhost" ||
          targetUrlObj.hostname === "127.0.0.1";

        if (!isB2Host) {
          throw new ValidationError(`Untrusted target upload host: '${targetUrlObj.hostname}'`);
        }

        // Limit web proxy payload to 80MB to fit within Cloudflare Worker memory limits
        const rawContentLength = request.headers.get("content-length");
        if (rawContentLength && parseInt(rawContentLength, 10) > 80 * 1024 * 1024) {
          return errorResponse(413, "PayloadTooLarge", "Web upload proxy limit is 80MB. Use direct B2 upload for larger files.");
        }

        // Buffer payload to memory as ArrayBuffer.
        // In Cloudflare Workers, passing a ReadableStream body causes fetch to strip Content-Length
        // and stream the upload via chunked transfer encoding (Transfer-Encoding: chunked).
        // Backblaze B2 S3 endpoint stalls on unsigned chunked PUT requests, causing Cloudflare
        // edge timeout (HTTP 524 Gateway Timeout).
        // Buffering the payload allows sending a non-chunked binary body with an exact Content-Length.
        const fileBuffer = await request.arrayBuffer();
        if (fileBuffer.byteLength > 80 * 1024 * 1024) {
          return errorResponse(413, "PayloadTooLarge", "Web upload proxy limit is 80MB. Use direct B2 upload for larger files.");
        }

        // Parse target URL's X-Amz-SignedHeaders to determine which headers were signed
        const signedHeadersParam =
          targetUrlObj.searchParams.get("X-Amz-SignedHeaders") ||
          targetUrlObj.searchParams.get("x-amz-signedheaders") ||
          "";
        const signedHeaderSet = new Set(
          signedHeadersParam.toLowerCase().split(";").map((s) => s.trim())
        );

        const forwardHeaders: Record<string, string> = {};
        const contentType = request.headers.get("content-type");
        if (contentType) {
          forwardHeaders["Content-Type"] = contentType;
        }
        forwardHeaders["Content-Length"] = fileBuffer.byteLength.toString();

        // Forward x-amz-* metadata headers only if they were signed (or if no signed headers were specified)
        for (const [key, value] of request.headers.entries()) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.startsWith("x-amz-")) {
            if (signedHeaderSet.size === 0 || signedHeaderSet.has(lowerKey)) {
              forwardHeaders[key] = value;
            }
          }
        }

        const b2Response = await fetch(targetUploadUrl, {
          method: "PUT",
          headers: forwardHeaders,
          body: fileBuffer,
        });

        if (!b2Response.ok) {
          const errText = await b2Response.text();
          return new Response(errText, {
            status: b2Response.status,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "text/plain",
            },
          });
        }

        return new Response(null, {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-upload-url, x-download-url, *",
          },
        });
      }

      // 6.5 Move B2 object (S3 CopyObject + DeleteObject)
      if (method === "POST" && (path === "/b2/move-object" || path === "/move-object")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json()) as {
          sourceObjectKey: string;
          destinationObjectKey: string;
        };

        if (!body.sourceObjectKey || !body.destinationObjectKey) {
          throw new ValidationError("Missing sourceObjectKey or destinationObjectKey");
        }

        validateObjectKey(body.sourceObjectKey, serverVaultId);
        validateObjectKey(body.destinationObjectKey, serverVaultId);

        const result = await moveObjectInB2(
          body.sourceObjectKey,
          body.destinationObjectKey,
          env
        );

        return jsonResponse(result);
      }

      // 6.6 Copy B2 object (S3 CopyObject only)
      if (method === "POST" && (path === "/b2/copy-object" || path === "/copy-object")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        await checkRateLimit(verifiedToken.uid, env);

        const body = (await request.json()) as {
          sourceObjectKey: string;
          destinationObjectKey: string;
        };

        if (!body.sourceObjectKey || !body.destinationObjectKey) {
          throw new ValidationError("Missing sourceObjectKey or destinationObjectKey");
        }

        validateObjectKey(body.sourceObjectKey, serverVaultId);
        validateObjectKey(body.destinationObjectKey, serverVaultId);

        const result = await copyObjectInB2(
          body.sourceObjectKey,
          body.destinationObjectKey,
          env
        );

        return jsonResponse(result);
      }

      // 7. Streaming download proxy fallback for browser CORS resilience (e.g. JSZip packaging)
      if (method === "GET" && (path === "/b2/download-proxy" || path === "/download-proxy")) {
        const targetDownloadUrl = request.headers.get("x-download-url") || url.searchParams.get("downloadUrl");
        if (!targetDownloadUrl) {
          throw new ValidationError("Missing required target 'x-download-url' header or query param");
        }

        const targetUrlObj = new URL(targetDownloadUrl);
        const isB2Host =
          targetUrlObj.hostname.endsWith(".backblazeb2.com") ||
          targetUrlObj.hostname.includes("backblaze") ||
          targetUrlObj.hostname === "localhost" ||
          targetUrlObj.hostname === "127.0.0.1";

        if (!isB2Host) {
          throw new ValidationError(`Untrusted target download host: '${targetUrlObj.hostname}'`);
        }

        const forwardHeaders: Record<string, string> = {};
        const range = request.headers.get("range");
        if (range) {
          forwardHeaders["Range"] = range;
        }

        const b2Response = await fetch(targetDownloadUrl, {
          headers: forwardHeaders,
        });
        if (!b2Response.ok) {
          return new Response(await b2Response.text(), {
            status: b2Response.status,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "text/plain",
            }
          });
        }

        const responseHeaders: Record<string, string> = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Content-Type": b2Response.headers.get("content-type") || "application/octet-stream",
        };
        const cl = b2Response.headers.get("content-length");
        if (cl) responseHeaders["Content-Length"] = cl;
        const cr = b2Response.headers.get("content-range");
        if (cr) responseHeaders["Content-Range"] = cr;
        const ar = b2Response.headers.get("accept-ranges");
        if (ar) responseHeaders["Accept-Ranges"] = ar;

        return new Response(b2Response.body, {
          status: b2Response.status,
          headers: responseHeaders,
        });
      }

      // 8. Register Google user for Admin pending approval
      if (method === "POST" && (path === "/b2/register-user" || path === "/register-user")) {
        const authHeader = request.headers.get("Authorization");
        const verifiedToken = await verifyFirebaseToken(authHeader, projectId);

        let body: any = {};
        try {
          body = await request.json();
        } catch {
          // optional body
        }

        const registeredUser: RegisteredUser = {
          uid: verifiedToken.uid,
          email: verifiedToken.email || body.email || "",
          displayName: body.displayName || verifiedToken.name || (verifiedToken.email ? verifiedToken.email.split("@")[0] : "User"),
          photoURL: body.photoURL || "",
          registeredAt: Date.now(),
        };

        pendingUsersMap.set(verifiedToken.uid, registeredUser);
        await persistPendingUsersToB2(serverVaultId, env);
        return jsonResponse({ success: true, user: registeredUser });
      }

      // 9. List registered pending users (for Admin dashboard)
      if (method === "GET" && (path === "/b2/list-pending-users" || path === "/list-pending-users")) {
        const authHeader = request.headers.get("Authorization");
        await verifyFirebaseToken(authHeader, projectId);

        if (pendingUsersMap.size === 0) {
          await loadPendingUsersFromB2(serverVaultId, env);
        }

        return jsonResponse({
          users: Array.from(pendingUsersMap.values()),
        });
      }

      return errorResponse(404, "Not Found", `Route '${method} ${path}' not found`);

    } catch (err: unknown) {
      if (err instanceof AuthenticationError) {
        return errorResponse(401, "Unauthorized", err.message);
      }
      if (err instanceof CrossVaultAccessError || err instanceof CrossOwnerAccessError) {
        return errorResponse(403, "Forbidden", err.message);
      }
      if (err instanceof ValidationError) {
        return errorResponse(400, "Bad Request", err.message);
      }
      if (err instanceof AuthorizationError) {
        return errorResponse(403, "Forbidden", err.message);
      }
      if (err instanceof RateLimitExceededError) {
        return errorResponse(429, "Too Many Requests", err.message);
      }

      console.error("Internal server error in B2 Authorizer:", err);
      return errorResponse(500, "Internal Server Error", "An internal error occurred");
    }
  }
};
