export interface TestKeyPair {
  keyId: string;
  privateKey: CryptoKey;
  publicKeyJwk: any;
}

export async function generateTestKeyPair(keyId = "test-key-1"): Promise<TestKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );

  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  jwk.kid = keyId;
  jwk.alg = "RS256";
  jwk.use = "sig";

  return {
    keyId,
    privateKey: keyPair.privateKey,
    publicKeyJwk: jwk
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSignedTestFirebaseToken(
  payload: Record<string, any>,
  keyPair: TestKeyPair,
  customHeader: Record<string, any> = {}
): Promise<string> {
  const header = {
    alg: "RS256",
    kid: keyPair.keyId,
    typ: "JWT",
    ...customHeader
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signedData = encoder.encode(`${headerB64}.${payloadB64}`);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    signedData
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}
