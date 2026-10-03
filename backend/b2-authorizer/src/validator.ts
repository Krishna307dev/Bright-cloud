import type { UploadAuthorizeRequest, DownloadAuthorizeRequest, Env, VerifiedToken } from "./types.ts";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class CrossVaultAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossVaultAccessError";
  }
}

// Alias for backward compatibility
export const CrossOwnerAccessError = CrossVaultAccessError;

const SHA256_REGEX = /^[a-f0-9]{64}$/;

export interface ParsedObjectKey {
  vaultId: string;
  sourceId: string;
  relativePath: string;
  storedName: string;
  objectKey: string;
}

export function validateObjectKey(objectKey: string, expectedVaultId?: string): ParsedObjectKey {
  if (!objectKey || typeof objectKey !== "string" || objectKey.trim().length === 0) {
    throw new ValidationError("Object key cannot be empty");
  }

  if (objectKey.length > 1024) {
    throw new ValidationError("Object key exceeds maximum length of 1024 characters");
  }

  if (objectKey.includes("\0")) {
    throw new ValidationError("Object key contains illegal null character");
  }

  // Path traversal checks (literal, URL-encoded, backslashes)
  if (
    objectKey.includes("..") ||
    objectKey.includes("%2e%2e") ||
    objectKey.includes("%2E%2E") ||
    objectKey.includes("\\")
  ) {
    throw new ValidationError("Path traversal is strictly prohibited");
  }

  if (!objectKey.startsWith("backups/")) {
    throw new ValidationError("Object key must start with 'backups/' prefix");
  }

  // Validate structural segments: backups/{vaultId}/{sourceId}/{remainder}
  const parts = objectKey.split("/");
  if (parts.length < 4) {
    throw new ValidationError(
      "Invalid object key structure: expected 'backups/{vaultId}/{sourceId}/{relativePath}{storedName}'"
    );
  }

  const [, vaultId, sourceId, ...fileParts] = parts;
  if (!vaultId || vaultId.trim().length === 0) {
    throw new ValidationError("VaultId in object key cannot be empty");
  }

  if (!sourceId || sourceId.trim().length === 0) {
    throw new ValidationError("SourceId in object key cannot be empty");
  }

  const storedName = fileParts[fileParts.length - 1];
  if (!storedName || storedName.trim().length === 0) {
    throw new ValidationError("Stored filename in object key cannot be empty");
  }

  const relativePath = fileParts.length > 1 ? fileParts.slice(0, -1).join("/") + "/" : "";

  if (expectedVaultId && expectedVaultId.trim().length > 0 && expectedVaultId !== vaultId) {
    throw new CrossVaultAccessError(
      `Cross-vault access denied: requested vault '${vaultId}' does not match configured vault '${expectedVaultId}'`
    );
  }

  return { vaultId, sourceId, relativePath, storedName, objectKey };
}

export function validateDrivePrefix(vaultId: string, sourceId: string, expectedVaultId?: string): string {
  if (!vaultId || typeof vaultId !== "string" || vaultId.trim().length === 0) {
    throw new ValidationError("VaultId cannot be empty");
  }
  if (!sourceId || typeof sourceId !== "string" || sourceId.trim().length === 0) {
    throw new ValidationError("SourceId cannot be empty");
  }

  // Prevent path traversal and nested slashes
  if (
    vaultId.includes("..") ||
    sourceId.includes("..") ||
    vaultId.includes("/") ||
    sourceId.includes("/") ||
    vaultId.includes("\\") ||
    sourceId.includes("\\") ||
    vaultId.includes("\0") ||
    sourceId.includes("\0")
  ) {
    throw new ValidationError("Path traversal in vaultId or sourceId is strictly prohibited");
  }

  if (expectedVaultId && expectedVaultId.trim().length > 0 && expectedVaultId !== vaultId) {
    throw new CrossVaultAccessError(
      `Cross-vault access denied: requested vault '${vaultId}' does not match configured vault '${expectedVaultId}'`
    );
  }

  return `backups/${vaultId}/${sourceId}/`;
}

export function validateUploadRequest(req: UploadAuthorizeRequest, expectedVaultId?: string): ParsedObjectKey {
  if (!req || typeof req !== "object") {
    throw new ValidationError("Request body must be a valid JSON object");
  }

  const parsed = validateObjectKey(req.objectKey, expectedVaultId);

  if (!req.sha256 || !SHA256_REGEX.test(req.sha256)) {
    throw new ValidationError(
      `Invalid SHA-256 hash: '${req.sha256}'. Expected 64-character lowercase hex string.`
    );
  }

  if (!req.sourceId || typeof req.sourceId !== "string" || req.sourceId.trim().length === 0) {
    throw new ValidationError("sourceId is required and cannot be empty");
  }

  if (
    !req.originalName ||
    typeof req.originalName !== "string" ||
    req.originalName.trim().length === 0
  ) {
    throw new ValidationError("originalName is required and cannot be empty");
  }

  if (!req.fileId || typeof req.fileId !== "string" || req.fileId.trim().length === 0) {
    throw new ValidationError("fileId is required and cannot be empty");
  }

  return parsed;
}

export interface ParsedDownloadRequest {
  fileId: string;
  vaultId: string;
}

export interface AuthorizedDownloadFile {
  b2ObjectKey: string;
  storedName?: string;
  originalName?: string;
}

export function validateDownloadRequest(
  req: DownloadAuthorizeRequest,
  expectedVaultId?: string
): ParsedDownloadRequest {
  if (!req || typeof req !== "object") {
    throw new ValidationError("Request body must be a valid JSON object");
  }

  if (!req.fileId || typeof req.fileId !== "string" || req.fileId.trim().length === 0) {
    throw new ValidationError("fileId is required and cannot be empty");
  }

  const fileId = req.fileId.trim();
  if (fileId.length > 256) {
    throw new ValidationError("fileId exceeds maximum length of 256 characters");
  }

  if (
    fileId.includes("/") ||
    fileId.includes("\\") ||
    fileId.includes("..") ||
    fileId.includes("%2e%2e") ||
    fileId.includes("%2E%2E") ||
    fileId.includes("\0")
  ) {
    throw new ValidationError("fileId contains illegal path traversal characters");
  }

  const vaultId = (req.vaultId?.trim() || expectedVaultId || "default").trim();

  if (expectedVaultId && expectedVaultId.trim().length > 0 && expectedVaultId !== vaultId) {
    throw new CrossVaultAccessError(
      `Cross-vault access denied: requested vault '${vaultId}' does not match configured vault '${expectedVaultId}'`
    );
  }

  return { fileId, vaultId };
}

export async function isAuthorizedToDownload(
  vaultId: string,
  caller: VerifiedToken,
  fileId: string,
  env?: Env,
  authHeader?: string
): Promise<AuthorizedDownloadFile | null> {
  // 1. Anonymous daemon is NEVER allowed to download
  if (caller.firebase?.sign_in_provider === "anonymous") {
    return null;
  }

  // 2. Custom permission checker (for testing or policy override)
  if (env?.PERMISSION_CHECKER) {
    const isAllowed = await env.PERMISSION_CHECKER(vaultId, caller, fileId);
    if (!isAllowed) return null;
    return {
      b2ObjectKey: `backups/${vaultId}/src1/${fileId}.pdf`,
      storedName: `${fileId}.pdf`
    };
  }

  // 3. Custom Firestore get file override (for testing)
  if (env?.FIRESTORE_GET_FILE) {
    const fileDoc = await env.FIRESTORE_GET_FILE(vaultId, fileId, authHeader);
    const sourceId = fileDoc.sourceId || fileDoc.fields?.sourceId?.stringValue;
    const originalName = fileDoc.originalName || fileDoc.fields?.originalName?.stringValue;
    const storedName = fileDoc.storedName || fileDoc.fields?.storedName?.stringValue || originalName || fileId;
    const relPath = fileDoc.relativePath || fileDoc.fields?.relativePath?.stringValue || "";
    const b2ObjectKey =
      fileDoc.b2ObjectKey ||
      fileDoc.fields?.b2ObjectKey?.stringValue ||
      (sourceId ? `backups/${vaultId}/${sourceId}/${relPath}${storedName}` : null);

    if (!b2ObjectKey) return null;
    validateObjectKey(b2ObjectKey, vaultId);
    return {
      b2ObjectKey,
      storedName,
      originalName
    };
  }

  // 4. Firestore direct document read using the caller's Google Bearer token
  const projectId = env?.FIREBASE_PROJECT_ID;
  if (!projectId) return null;

  try {
    const fileUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/vaults/${vaultId}/files/${fileId}`;
    const headers: Record<string, string> = {
      "Accept": "application/json"
    };
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const response = await fetch(fileUrl, {
      method: "GET",
      headers
    });

    if (!response.ok) {
      // 403 Forbidden or 404 Not Found from Firestore Security Rules
      return null;
    }

    const doc = (await response.json()) as {
      fields?: {
        b2ObjectKey?: { stringValue?: string };
        storedName?: { stringValue?: string };
        originalName?: { stringValue?: string };
        sourceId?: { stringValue?: string };
        relativePath?: { stringValue?: string };
      };
    };

    const sourceId = doc.fields?.sourceId?.stringValue;
    const originalName = doc.fields?.originalName?.stringValue;
    const storedName = doc.fields?.storedName?.stringValue || originalName || fileId;
    const relPath = doc.fields?.relativePath?.stringValue || "";
    const b2ObjectKey =
      doc.fields?.b2ObjectKey?.stringValue ||
      (sourceId ? `backups/${vaultId}/${sourceId}/${relPath}${storedName}` : null);

    if (!b2ObjectKey) {
      return null;
    }

    // Ensure b2ObjectKey belongs to backups/${vaultId}/
    validateObjectKey(b2ObjectKey, vaultId);

    return {
      b2ObjectKey,
      storedName,
      originalName
    };
  } catch (err) {
    console.error(`Failed checking Firestore permissions for file ${fileId} in vault ${vaultId}:`, err);
    return null;
  }
}

