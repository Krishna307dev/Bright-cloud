export interface Env {
  FIREBASE_PROJECT_ID: string;
  ENVIRONMENT?: string;
  AUTH_TOKEN_SECRET?: string;
  VAULT_ID?: string;
  INITIAL_ADMIN_GOOGLE_UID?: string;
  B2_ENDPOINT?: string;
  B2_BUCKET?: string;
  B2_REGION?: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  RATE_LIMITER?: { limit: (options: { key: string }) => Promise<{ success: boolean }> };
  PERMISSION_CHECKER?: (vaultId: string, caller: VerifiedToken, fileId: string) => Promise<boolean> | boolean;
  FIRESTORE_GET_FILE?: (vaultId: string, fileId: string, authHeader?: string) => Promise<any> | any;
}

export interface UploadAuthorizeRequest {
  objectKey: string;
  sha256: string;
  sourceId: string;
  originalName: string;
  fileId: string;
  fileSize?: number;
}

export interface UploadAuthorizeResponse {
  uploadUrl: string;
  expiresAt: number;
  headers: Record<string, string>;
  uploadMode?: "DIRECT_PRESIGNED_PUT";
}

export interface HeadAuthorizeRequest {
  objectKey: string;
}

export interface HeadAuthorizeResponse {
  headUrl: string;
  expiresAt: number;
  headers?: Record<string, string>;
}

export interface DownloadAuthorizeRequest {
  fileId: string;
  vaultId?: string;
}

export interface DownloadAuthorizeResponse {
  downloadUrl: string;
  expiresAt: number;
  fileId: string;
  storedName?: string;
  headers?: Record<string, string>;
}

export interface VerifiedToken {
  uid: string;
  email?: string;
  firebase?: {
    sign_in_provider?: string;
    [key: string]: any;
  };
  authTime: number;
  exp: number;
  iss: string;
  aud: string;
}

