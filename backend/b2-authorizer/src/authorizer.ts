import type {
  Env,
  UploadAuthorizeRequest,
  UploadAuthorizeResponse,
  HeadAuthorizeResponse,
  DownloadAuthorizeResponse
} from "./types.ts";
import { createB2PresignedUrl } from "./sigv4.ts";

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function generateUploadAuthorization(
  req: UploadAuthorizeRequest,
  verifiedUid: string,
  env: Env
): Promise<UploadAuthorizeResponse> {
  const ttlMs = 3600_000; // 1 hour TTL
  const expiresAt = Date.now() + ttlMs;

  const headers: Record<string, string> = {
    "x-amz-meta-sha256": req.sha256,
    "x-amz-meta-source-id": req.sourceId,
    "x-amz-meta-original-name": req.originalName,
    "x-amz-meta-file-id": req.fileId
  };

  const endpoint = env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com";
  const bucketName = env.B2_BUCKET || "BrightCloud";
  const region = env.B2_REGION || "eu-central-003";
  const keyId = env.B2_KEY_ID || "dev-b2-key-id";
  const applicationKey = env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef";

  const uploadUrl = await createB2PresignedUrl(
    {
      endpoint,
      keyId,
      applicationKey,
      bucketName,
      region
    },
    {
      method: "PUT",
      objectKey: req.objectKey,
      expiresInSeconds: 3600
    }
  );

  return {
    uploadUrl,
    expiresAt,
    headers,
    uploadMode: "DIRECT_PRESIGNED_PUT"
  };
}

export async function generateHeadAuthorization(
  objectKey: string,
  verifiedUid: string,
  env: Env
): Promise<HeadAuthorizeResponse> {
  const ttlMs = 3600_000;
  const expiresAt = Date.now() + ttlMs;

  const endpoint = env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com";
  const bucketName = env.B2_BUCKET || "BrightCloud";
  const region = env.B2_REGION || "eu-central-003";
  const keyId = env.B2_KEY_ID || "dev-b2-key-id";
  const applicationKey = env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef";

  const headUrl = await createB2PresignedUrl(
    {
      endpoint,
      keyId,
      applicationKey,
      bucketName,
      region
    },
    {
      method: "HEAD",
      objectKey,
      expiresInSeconds: 3600
    }
  );

  return {
    headUrl,
    expiresAt,
    headers: {}
  };
}

export function sanitizeFilename(name: string): string {
  // Strip quotes, backslashes, CR/LF, path separators (/ and \), and control characters
  const clean = name.replace(/["'\\/\r\n\x00-\x1f\x7f]/g, "").trim().slice(0, 200);
  return clean || "download";
}

export function toAsciiSafe(name: string): string {
  // Replace non-ASCII and characters problematic in quoted headers with underscores
  const ascii = name.replace(/[^\x20-\x7E]|["\\;]/g, "_").trim();
  return ascii || "download";
}

export function encodeRfc5987(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function buildContentDisposition(filename: string): string {
  const sanitized = sanitizeFilename(filename);
  const asciiSafe = toAsciiSafe(sanitized);
  const rfc5987 = encodeRfc5987(sanitized);
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${rfc5987}`;
}

export async function generateDownloadAuthorization(
  objectKey: string,
  callerUid: string,
  env: Env,
  expiresInSeconds: number = 3600,
  options?: {
    disposition?: 'inline' | 'attachment';
    filename?: string;
  }
): Promise<DownloadAuthorizeResponse> {
  const ttlMs = expiresInSeconds * 1000;
  const expiresAt = Date.now() + ttlMs;

  const endpoint = env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com";
  const bucketName = env.B2_BUCKET || "BrightCloud";
  const region = env.B2_REGION || "eu-central-003";
  const keyId = env.B2_KEY_ID || "dev-b2-key-id";
  const applicationKey = env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef";

  const queryParams: Record<string, string> = {};
  if (options?.disposition === 'attachment') {
    const rawFilename = options.filename || objectKey.split('/').pop() || 'download';
    queryParams['response-content-disposition'] = buildContentDisposition(rawFilename);
  }

  const downloadUrl = await createB2PresignedUrl(
    {
      endpoint,
      keyId,
      applicationKey,
      bucketName,
      region
    },
    {
      method: "GET",
      objectKey,
      expiresInSeconds,
      ...(Object.keys(queryParams).length > 0 ? { queryParams } : {})
    }
  );

  return {
    downloadUrl,
    expiresAt,
    fileId: "",
    headers: {}
  };
}

export async function generateDeleteAuthorization(
  objectKey: string,
  verifiedUid: string,
  env: Env
): Promise<{ deleteUrl: string; expiresAt: number; headers: Record<string, string> }> {
  const ttlMs = 3600_000;
  const expiresAt = Date.now() + ttlMs;

  const endpoint = env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com";
  const bucketName = env.B2_BUCKET || "BrightCloud";
  const region = env.B2_REGION || "eu-central-003";
  const keyId = env.B2_KEY_ID || "dev-b2-key-id";
  const applicationKey = env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef";

  const deleteUrl = await createB2PresignedUrl(
    {
      endpoint,
      keyId,
      applicationKey,
      bucketName,
      region
    },
    {
      method: "DELETE",
      objectKey,
      expiresInSeconds: 3600
    }
  );

  return {
    deleteUrl,
    expiresAt,
    headers: {}
  };
}

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getB2Config(env: Env) {
  return {
    endpoint: env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com",
    bucketName: env.B2_BUCKET || "BrightCloud",
    region: env.B2_REGION || "eu-central-003",
    keyId: env.B2_KEY_ID || "dev-b2-key-id",
    applicationKey: env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef"
  };
}

export async function executeDirectB2Delete(
  objectKey: string,
  env: Env
): Promise<{ success: boolean; deleted: boolean; objectKey: string }> {
  const config = getB2Config(env);

  try {
    // 1. In Backblaze B2 with versioning enabled, standard DELETE creates a DeleteMarker
    // and preserves older object versions (leaving hidden duplicates).
    // To completely and permanently purge the object without leaving hide markers or duplicate versions:
    const listVersionsUrl = await createB2PresignedUrl(config, {
      method: "GET",
      objectKey: "",
      queryParams: {
        versions: "",
        prefix: objectKey
      },
      expiresInSeconds: 300
    });

    let versionsPurged = 0;
    try {
      const listRes = await fetch(listVersionsUrl, { method: "GET" });
      if (listRes.ok) {
        const xml = await listRes.text();
        const itemsToPurge: Array<{ key: string; versionId: string }> = [];

        // Match all <Version> blocks
        const versionBlockRegex = /<Version>([\s\S]*?)<\/Version>/g;
        let vMatch: RegExpExecArray | null;
        while ((vMatch = versionBlockRegex.exec(xml)) !== null) {
          const block = vMatch[1];
          const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
          const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
          if (rawKey && versionId) {
            const itemKey = unescapeXml(rawKey);
            const isMatch = objectKey.endsWith('/') ? itemKey.startsWith(objectKey) : itemKey === objectKey;
            if (isMatch) {
              itemsToPurge.push({ key: itemKey, versionId });
            }
          }
        }

        // Match all <DeleteMarker> blocks
        const markerBlockRegex = /<DeleteMarker>([\s\S]*?)<\/DeleteMarker>/g;
        let mMatch: RegExpExecArray | null;
        while ((mMatch = markerBlockRegex.exec(xml)) !== null) {
          const block = mMatch[1];
          const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
          const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
          if (rawKey && versionId) {
            const itemKey = unescapeXml(rawKey);
            const isMatch = objectKey.endsWith('/') ? itemKey.startsWith(objectKey) : itemKey === objectKey;
            if (isMatch) {
              itemsToPurge.push({ key: itemKey, versionId });
            }
          }
        }

        for (const item of itemsToPurge) {
          const delUrl = await createB2PresignedUrl(config, {
            method: "DELETE",
            objectKey: item.key,
            queryParams: {
              versionId: item.versionId
            },
            expiresInSeconds: 300
          });

          const delRes = await fetch(delUrl, {
            method: "DELETE",
            headers: { "Content-Length": "0" }
          });
          if (delRes.ok || delRes.status === 204) {
            versionsPurged++;
          }
        }
      }
    } catch (listErr) {
      console.warn(`Version listing failed for '${objectKey}', proceeding to standard delete:`, listErr);
    }

    // 2. If no versions were listed/purged (e.g. unversioned bucket or empty list), perform standard delete fallback
    if (versionsPurged === 0) {
      const deleteUrl = await createB2PresignedUrl(config, {
        method: "DELETE",
        objectKey,
        expiresInSeconds: 300
      });

      const res = await fetch(deleteUrl, {
        method: "DELETE",
        headers: {
          "Content-Length": "0"
        }
      });

      return {
        success: res.ok || res.status === 204 || res.status === 404,
        deleted: res.ok || res.status === 204,
        objectKey
      };
    }

    return {
      success: true,
      deleted: true,
      objectKey
    };
  } catch (err) {
    console.warn(`Direct B2 delete error for '${objectKey}':`, err);
    return { success: false, deleted: false, objectKey };
  }
}

export async function moveObjectInB2(
  sourceObjectKey: string,
  destinationObjectKey: string,
  env: Env
): Promise<{ success: boolean; sourceObjectKey: string; destinationObjectKey: string; movedInB2: boolean }> {
  if (sourceObjectKey === destinationObjectKey) {
    return { success: true, sourceObjectKey, destinationObjectKey, movedInB2: true };
  }

  const endpoint = env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com";
  const bucketName = env.B2_BUCKET || "BrightCloud";
  const region = env.B2_REGION || "eu-central-003";
  const keyId = env.B2_KEY_ID || "dev-b2-key-id";
  const applicationKey = env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef";

  // URL-encode bucket and path segments for x-amz-copy-source header
  const copySource = `/${encodeURIComponent(bucketName)}/${sourceObjectKey.split('/').map(encodeURIComponent).join('/')}`;
  const copyHeaders: Record<string, string> = {
    "x-amz-copy-source": copySource
  };

  const copyUrl = await createB2PresignedUrl(
    { endpoint, keyId, applicationKey, bucketName, region },
    {
      method: "PUT",
      objectKey: destinationObjectKey,
      expiresInSeconds: 300,
      headers: copyHeaders
    }
  );

  let movedInB2 = false;
  try {
    const copyRes = await fetch(copyUrl, {
      method: "PUT",
      headers: {
        ...copyHeaders,
        "Content-Length": "0"
      }
    });

    if (copyRes.ok) {
      movedInB2 = true;
      await executeDirectB2Delete(sourceObjectKey, env);
    } else if (copyRes.status === 404) {
      console.warn(`Source object '${sourceObjectKey}' not found in B2 during copy.`);
    } else {
      const errText = await copyRes.text();
      console.warn(`B2 CopyObject returned HTTP ${copyRes.status}: ${errText}`);
    }
  } catch (err) {
    console.warn("B2 moveObject error:", err);
  }

  return { success: true, sourceObjectKey, destinationObjectKey, movedInB2 };
}

export async function copyObjectInB2(
  sourceObjectKey: string,
  destinationObjectKey: string,
  env: Env
): Promise<{ success: boolean; sourceObjectKey: string; destinationObjectKey: string; copiedInB2: boolean }> {
  if (sourceObjectKey === destinationObjectKey) {
    return { success: true, sourceObjectKey, destinationObjectKey, copiedInB2: true };
  }

  const endpoint = env.B2_ENDPOINT || "https://s3.eu-central-003.backblazeb2.com";
  const bucketName = env.B2_BUCKET || "BrightCloud";
  const region = env.B2_REGION || "eu-central-003";
  const keyId = env.B2_KEY_ID || "dev-b2-key-id";
  const applicationKey = env.B2_APPLICATION_KEY || "dev-b2-app-key-1234567890abcdef";

  const copySource = `/${encodeURIComponent(bucketName)}/${sourceObjectKey.split('/').map(encodeURIComponent).join('/')}`;
  const copyHeaders: Record<string, string> = {
    "x-amz-copy-source": copySource
  };

  const copyUrl = await createB2PresignedUrl(
    { endpoint, keyId, applicationKey, bucketName, region },
    {
      method: "PUT",
      objectKey: destinationObjectKey,
      expiresInSeconds: 300,
      headers: copyHeaders
    }
  );

  let copiedInB2 = false;
  try {
    const copyRes = await fetch(copyUrl, {
      method: "PUT",
      headers: {
        ...copyHeaders,
        "Content-Length": "0"
      }
    });

    if (copyRes.ok) {
      copiedInB2 = true;
    } else if (copyRes.status === 404) {
      console.warn(`Source object '${sourceObjectKey}' not found in B2 during copy.`);
    } else {
      const errText = await copyRes.text();
      console.warn(`B2 CopyObject returned HTTP ${copyRes.status}: ${errText}`);
    }
  } catch (err) {
    console.warn("B2 copyObject error:", err);
  }

  return { success: true, sourceObjectKey, destinationObjectKey, copiedInB2 };
}

/**
 * Permanently purges all files, versions, and delete markers under an S3 folder prefix in Backblaze B2.
 * Used for drive deletion to completely reclaim user storage quota.
 */
export async function executePurgePrefixInB2(
  prefix: string,
  env: Env
): Promise<{ success: boolean; prefix: string; versionsPurged: number }> {
  const config = getB2Config(env);
  let versionsPurged = 0;
  let keyMarker: string | undefined = undefined;
  let versionIdMarker: string | undefined = undefined;
  let isTruncated = true;
  let pageCount = 0;
  const MAX_PAGES = 50; // Up to 50,000 versions per drive

  while (isTruncated && pageCount < MAX_PAGES) {
    pageCount++;
    const queryParams: Record<string, string> = {
      versions: "",
      prefix: prefix
    };
    if (keyMarker) queryParams["key-marker"] = keyMarker;
    if (versionIdMarker) queryParams["version-id-marker"] = versionIdMarker;

    const listVersionsUrl = await createB2PresignedUrl(config, {
      method: "GET",
      objectKey: "",
      queryParams,
      expiresInSeconds: 300
    });

    const listRes = await fetch(listVersionsUrl, { method: "GET" });
    if (!listRes.ok) {
      console.warn(`B2 prefix version listing returned HTTP ${listRes.status} for prefix '${prefix}'`);
      break;
    }

    const xml = await listRes.text();
    const itemsToPurge: Array<{ key: string; versionId: string }> = [];

    // Match all <Version> blocks
    const versionBlockRegex = /<Version>([\s\S]*?)<\/Version>/g;
    let vMatch: RegExpExecArray | null;
    while ((vMatch = versionBlockRegex.exec(xml)) !== null) {
      const block = vMatch[1];
      const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
      if (rawKey && versionId) {
        const itemKey = unescapeXml(rawKey);
        if (itemKey.startsWith(prefix)) {
          itemsToPurge.push({ key: itemKey, versionId });
        }
      }
    }

    // Match all <DeleteMarker> blocks
    const markerBlockRegex = /<DeleteMarker>([\s\S]*?)<\/DeleteMarker>/g;
    let mMatch: RegExpExecArray | null;
    while ((mMatch = markerBlockRegex.exec(xml)) !== null) {
      const block = mMatch[1];
      const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
      if (rawKey && versionId) {
        const itemKey = unescapeXml(rawKey);
        if (itemKey.startsWith(prefix)) {
          itemsToPurge.push({ key: itemKey, versionId });
        }
      }
    }

    // Purge items found in this page
    for (const item of itemsToPurge) {
      try {
        const delUrl = await createB2PresignedUrl(config, {
          method: "DELETE",
          objectKey: item.key,
          queryParams: {
            versionId: item.versionId
          },
          expiresInSeconds: 300
        });

        const delRes = await fetch(delUrl, {
          method: "DELETE",
          headers: { "Content-Length": "0" }
        });
        if (delRes.ok || delRes.status === 204) {
          versionsPurged++;
        }
      } catch (delErr) {
        console.warn(`Failed to delete version '${item.key}' (${item.versionId}):`, delErr);
      }
    }

    // Check pagination
    const isTruncatedMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/i);
    isTruncated = isTruncatedMatch ? isTruncatedMatch[1].toLowerCase() === "true" : false;

    if (isTruncated) {
      const nextKey = xml.match(/<NextKeyMarker>([\s\S]*?)<\/NextKeyMarker>/)?.[1];
      const nextVersion = xml.match(/<NextVersionIdMarker>([\s\S]*?)<\/NextVersionIdMarker>/)?.[1];
      keyMarker = nextKey ? unescapeXml(nextKey) : undefined;
      versionIdMarker = nextVersion ? unescapeXml(nextVersion) : undefined;
      if (!keyMarker) {
        break;
      }
    }
  }

  return { success: true, prefix, versionsPurged };
}

/**
 * Executes a full storage wipe for the entire vault in Backblaze B2,
 * permanently deleting all object versions and delete markers under `backups/{vaultId}/`,
 * while strictly preserving system metadata (e.g. `backups/{vaultId}/_system/`).
 */
export async function executePurgeVaultInB2(
  vaultId: string,
  env: Env
): Promise<{ success: boolean; vaultId: string; versionsPurged: number }> {
  const prefix = `backups/${vaultId}/`;
  const systemPrefix = `backups/${vaultId}/_system/`;
  const config = getB2Config(env);

  let keyMarker: string | undefined = undefined;
  let versionIdMarker: string | undefined = undefined;
  let isTruncated = true;
  let versionsPurged = 0;

  while (isTruncated) {
    const queryParams: Record<string, string> = {
      versions: "",
      prefix,
      "max-keys": "1000"
    };

    if (keyMarker) queryParams["key-marker"] = keyMarker;
    if (versionIdMarker) queryParams["version-id-marker"] = versionIdMarker;

    const listVersionsUrl = await createB2PresignedUrl(config, {
      method: "GET",
      objectKey: "",
      queryParams,
      expiresInSeconds: 300
    });

    const listRes = await fetch(listVersionsUrl, { method: "GET" });
    if (!listRes.ok) {
      console.warn(`B2 vault version listing returned HTTP ${listRes.status} for prefix '${prefix}'`);
      break;
    }

    const xml = await listRes.text();
    const itemsToPurge: Array<{ key: string; versionId: string }> = [];

    // Match all <Version> blocks
    const versionBlockRegex = /<Version>([\s\S]*?)<\/Version>/g;
    let vMatch: RegExpExecArray | null;
    while ((vMatch = versionBlockRegex.exec(xml)) !== null) {
      const block = vMatch[1];
      const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
      if (rawKey && versionId) {
        const itemKey = unescapeXml(rawKey);
        if (itemKey.startsWith(systemPrefix)) {
          continue; // Preserve system files
        }
        if (itemKey.startsWith(prefix)) {
          itemsToPurge.push({ key: itemKey, versionId });
        }
      }
    }

    // Match all <DeleteMarker> blocks
    const markerBlockRegex = /<DeleteMarker>([\s\S]*?)<\/DeleteMarker>/g;
    let mMatch: RegExpExecArray | null;
    while ((mMatch = markerBlockRegex.exec(xml)) !== null) {
      const block = mMatch[1];
      const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
      if (rawKey && versionId) {
        const itemKey = unescapeXml(rawKey);
        if (itemKey.startsWith(systemPrefix)) {
          continue; // Preserve system files
        }
        if (itemKey.startsWith(prefix)) {
          itemsToPurge.push({ key: itemKey, versionId });
        }
      }
    }

    // Purge items found in this page
    for (const item of itemsToPurge) {
      try {
        const delUrl = await createB2PresignedUrl(config, {
          method: "DELETE",
          objectKey: item.key,
          queryParams: {
            versionId: item.versionId
          },
          expiresInSeconds: 300
        });

        const delRes = await fetch(delUrl, {
          method: "DELETE",
          headers: { "Content-Length": "0" }
        });
        if (delRes.ok || delRes.status === 204) {
          versionsPurged++;
        }
      } catch (delErr) {
        console.warn(`Failed to delete version '${item.key}' (${item.versionId}):`, delErr);
      }
    }

    // Check pagination
    const isTruncatedMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/i);
    isTruncated = isTruncatedMatch ? isTruncatedMatch[1].toLowerCase() === "true" : false;

    if (isTruncated) {
      const nextKey = xml.match(/<NextKeyMarker>([\s\S]*?)<\/NextKeyMarker>/)?.[1];
      const nextVersion = xml.match(/<NextVersionIdMarker>([\s\S]*?)<\/NextVersionIdMarker>/)?.[1];
      keyMarker = nextKey ? unescapeXml(nextKey) : undefined;
      versionIdMarker = nextVersion ? unescapeXml(nextVersion) : undefined;
      if (!keyMarker) {
        break;
      }
    }
  }

  return { success: true, vaultId, versionsPurged };
}

