import type { VerifiedToken } from "./types.ts";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

interface JWK {
  kid: string;
  alg: string;
  kty: string;
  use: string;
  n: string;
  e: string;
}

interface JWKSResponse {
  keys?: JWK[];
  [key: string]: any;
}

let cachedKeys: JWK[] | null = null;
let cachedKeysExpiry = 0;

async function fetchGoogleJWKS(): Promise<JWK[]> {
  const now = Date.now();
  if (cachedKeys && cachedKeysExpiry > now) {
    return cachedKeys;
  }

  const url = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
  const res = await fetch(url);
  if (!res.ok) {
    throw new AuthenticationError(`Failed to fetch Google JWKS keys: HTTP ${res.status}`);
  }

  const data = (await res.json()) as JWKSResponse;
  let keys: JWK[] = [];

  if (Array.isArray(data.keys)) {
    keys = data.keys;
  } else {
    for (const kid of Object.keys(data)) {
      if (typeof data[kid] === "object") {
        keys.push({ ...data[kid], kid });
      }
    }
  }

  if (keys.length === 0) {
    throw new AuthenticationError("No public keys found in Google JWKS response");
  }

  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlSeconds = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

  cachedKeys = keys;
  cachedKeysExpiry = now + ttlSeconds * 1000;

  return keys;
}

function base64UrlDecodeToUint8Array(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function base64UrlDecodeToString(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return atob(base64);
}

export async function verifyFirebaseToken(
  authHeader: string | null,
  expectedProjectId: string,
  jwksOverride?: JWK[]
): Promise<VerifiedToken> {
  if (!authHeader || typeof authHeader !== "string") {
    throw new AuthenticationError("Missing Authorization header");
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new AuthenticationError("Authorization header must use Bearer scheme");
  }

  const token = authHeader.substring("Bearer ".length).trim();
  if (!token) {
    throw new AuthenticationError("Empty Bearer token");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthenticationError("Malformed JWT: Expected 3 segments");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { kid?: string; alg?: string; typ?: string };
  let payload: {
    iss?: string;
    aud?: string;
    auth_time?: number;
    sub?: string;
    exp?: number;
    email?: string;
    [key: string]: any;
  };

  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch (e) {
    throw new AuthenticationError("Failed to parse JWT header or payload as JSON");
  }

  if (header.alg !== "RS256") {
    throw new AuthenticationError(`Unsupported algorithm '${header.alg}', expected RS256`);
  }

  if (!header.kid) {
    throw new AuthenticationError("Missing 'kid' in JWT header");
  }

  const keys = jwksOverride || (await fetchGoogleJWKS());
  const matchingKey = keys.find((k) => k.kid === header.kid);
  if (!matchingKey) {
    throw new AuthenticationError(`No matching public key found in Google JWKS for kid '${header.kid}'`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    matchingKey,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["verify"]
  );

  const encoder = new TextEncoder();
  const signedData = encoder.encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlDecodeToUint8Array(signatureB64);

  const isValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signatureBytes,
    signedData
  );

  if (!isValid) {
    throw new AuthenticationError("Invalid JWT cryptographic signature");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp <= nowSeconds) {
    throw new AuthenticationError(`Token has expired (exp: ${payload.exp}, current: ${nowSeconds})`);
  }

  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  if (payload.iss !== expectedIssuer) {
    throw new AuthenticationError(`Invalid token issuer '${payload.iss}', expected '${expectedIssuer}'`);
  }

  if (payload.aud !== expectedProjectId) {
    throw new AuthenticationError(`Invalid token audience '${payload.aud}', expected '${expectedProjectId}'`);
  }

  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    throw new AuthenticationError("Token missing valid 'sub' (Firebase UID)");
  }

  return {
    uid: payload.sub,
    email: payload.email,
    firebase: payload.firebase,
    authTime: payload.auth_time || 0,
    exp: payload.exp,
    iss: payload.iss,
    aud: payload.aud
  };
}

