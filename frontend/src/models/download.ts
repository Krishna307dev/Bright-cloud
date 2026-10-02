/**
 * Download authorization returned by Cloudflare Worker /b2/download-authorize.
 */
export interface DownloadAuthorization {
  downloadUrl: string; // Scoped short-lived presigned GET URL (15-min expiry)
  expiresAt: string;
  fileId: string;
  storedName: string;
}
