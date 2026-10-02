export interface SigV4Config {
  endpoint: string; // e.g. "https://s3.eu-central-003.backblazeb2.com"
  keyId: string;
  applicationKey: string;
  bucketName: string;
  region: string; // e.g. "eu-central-003"
}

export interface PresignOptions {
  method: "PUT" | "GET" | "HEAD" | "DELETE";
  objectKey: string;
  expiresInSeconds?: number;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(buffer);
}

function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const mins = String(date.getUTCMinutes()).padStart(2, "0");
  const secs = String(date.getUTCSeconds()).padStart(2, "0");

  const dateStamp = `${year}${month}${day}`;
  const amzDate = `${dateStamp}T${hours}${mins}${secs}Z`;
  return { amzDate, dateStamp };
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalizeUri(uri: string): string {
  const parts = uri.split("/");
  return parts.map(encodeRfc3986).join("/");
}

export async function createB2PresignedUrl(
  config: SigV4Config,
  options: PresignOptions
): Promise<string> {
  const region = config.region;
  const service = "s3";
  const expiresIn = options.expiresInSeconds || 3600; // 1 hour default

  const endpointUrl = new URL(config.endpoint);
  const host = endpointUrl.host;
  const endpoint = `${endpointUrl.protocol}//${host}`;

  const now = new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = options.objectKey
    ? `/${encodeRfc3986(config.bucketName)}/${canonicalizeUri(options.objectKey)}`
    : `/${encodeRfc3986(config.bucketName)}`;

  // Canonical headers
  const normalizedHeaders: Record<string, string> = {
    host: host.toLowerCase()
  };

  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      normalizedHeaders[k.toLowerCase()] = v.trim();
    }
  }

  const sortedHeaderKeys = Object.keys(normalizedHeaders).sort();
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${normalizedHeaders[k]}\n`)
    .join("");

  // Query parameters for presigning
  const queryParams: Record<string, string> = {
    ...(options.queryParams || {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.keyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaders
  };

  const sortedQueryKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedQueryKeys
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k])}`)
    .join("&");

  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join("\n");

  // Derive signing key
  const kSecret = new TextEncoder().encode(`AWS4${config.applicationKey}`);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");

  // Calculate signature
  const signatureBuffer = await hmacSha256(kSigning, stringToSign);
  const signature = toHex(signatureBuffer);

  return `${endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}
