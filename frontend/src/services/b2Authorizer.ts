import { auth, B2_AUTHORIZER_URL } from './firebase';
import type { DownloadAuthorization } from '../models';

export interface HealthDiagnostics {
  healthy: boolean;
  status?: string;
  message?: string;
  service?: string;
  storageProvider?: string;
  vaultId?: string;
  bucket?: string;
}

export interface UploadAuthorizeParams {
  objectKey: string;
  sha256: string;
  sourceId: string;
  originalName: string;
  fileId: string;
  fileSize?: number;
}

export interface UploadAuthorization {
  uploadUrl: string;
  expiresAt: number;
  headers: Record<string, string>;
  uploadMode?: string;
}

export interface DeleteAuthorization {
  deleteUrl: string;
  method: string;
  expiresAt: number;
  headers: Record<string, string>;
}

export class B2AuthorizerClient {
  /**
   * Pings the Cloudflare Worker health endpoint.
   * Accepts both "healthy" (production authorizer) and "ok" (legacy/mock).
   */
  static async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${B2_AUTHORIZER_URL}/health`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === 'healthy' || data.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Performs a comprehensive diagnostic ping of the authorizer endpoint.
   */
  static async getHealthDiagnostics(): Promise<HealthDiagnostics> {
    try {
      const res = await fetch(`${B2_AUTHORIZER_URL}/health`);
      if (!res.ok) {
        return {
          healthy: false,
          status: `HTTP ${res.status}`,
          message: `Endpoint returned error HTTP ${res.status} ${res.statusText}`,
        };
      }
      const data = await res.json();
      const isHealthy = data.status === 'healthy' || data.status === 'ok';
      return {
        healthy: isHealthy,
        status: data.status,
        service: data.service,
        storageProvider: data.storageProvider,
        vaultId: data.vaultId,
        bucket: data.bucket,
        message: isHealthy ? 'Authorizer is online and healthy.' : `Unexpected status: ${data.status}`,
      };
    } catch (err: any) {
      return {
        healthy: false,
        status: 'Unreachable',
        message: err?.message || 'Network error: could not connect to authorizer endpoint.',
      };
    }
  }

  /**
   * Requests a scoped, short-lived AWS SigV4 presigned GET URL from the Cloudflare Worker.
   * Master B2 secrets and b2ObjectKey remain hidden server-side.
   */
  static async requestDownloadAuthorization(
    vaultId: string,
    fileId: string
  ): Promise<DownloadAuthorization> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to authorize file download.');
    }

    const token = await user.getIdToken();

    const response = await fetch(`${B2_AUTHORIZER_URL}/b2/download-authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ vaultId, fileId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Authorization failed: HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) errorMsg = errorJson.error;
      } catch {
        if (errorText) errorMsg = errorText;
      }
      throw new Error(errorMsg);
    }

    return (await response.json()) as DownloadAuthorization;
  }

  /**
   * Authorizes and initiates browser download using programmatic temporary anchor tag.
   * Hands off stream directly to native browser download manager to avoid memory pressure on large files.
   */
  static async triggerDownload(
    vaultId: string,
    fileId: string,
    fallbackStoredName: string
  ): Promise<void> {
    const authData = await this.requestDownloadAuthorization(vaultId, fileId);
    const filename = authData.storedName || fallbackStoredName || 'download';

    // Verify object existence before launching browser download via Range: bytes=0-0
    // Method MUST be GET to match the presigned GET URL AWS SigV4 signature
    try {
      const probeRes = await fetch(authData.downloadUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      if (probeRes.status === 404) {
        throw new Error('File not available in cloud storage');
      }
    } catch (probeErr: any) {
      if (probeErr?.message === 'File not available in cloud storage') {
        throw probeErr;
      }
      // If direct fetch hit CORS or network error, verify via download-proxy
      try {
        const proxyProbeUrl = `${B2_AUTHORIZER_URL}/b2/download-proxy?downloadUrl=${encodeURIComponent(authData.downloadUrl)}`;
        const proxyProbe = await fetch(proxyProbeUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
        });
        if (proxyProbe.status === 404) {
          throw new Error('File not available in cloud storage');
        }
      } catch (proxyErr: any) {
        if (proxyErr?.message === 'File not available in cloud storage') {
          throw proxyErr;
        }
      }
    }

    const anchor = document.createElement('a');
    anchor.href = authData.downloadUrl;
    anchor.download = filename;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  /**
   * Requests a scoped, short-lived AWS SigV4 presigned PUT URL for direct browser-to-B2 upload.
   */
  static async requestUploadAuthorization(
    params: UploadAuthorizeParams
  ): Promise<UploadAuthorization> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to authorize file upload.');
    }

    const token = await user.getIdToken();

    const response = await fetch(`${B2_AUTHORIZER_URL}/b2/upload-authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Upload authorization failed: HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) errorMsg = errorJson.error;
      } catch {
        if (errorText) errorMsg = errorText;
      }
      throw new Error(errorMsg);
    }

    return (await response.json()) as UploadAuthorization;
  }

  /**
   * Executes streaming upload proxy via Cloudflare Worker fallback when direct B2 PUT hits CORS or network issues.
   */
  static async executeProxyPut(
    uploadUrl: string,
    fileOrBlob: Blob | File,
    headers: Record<string, string> = {},
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void> {
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : '';

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `${B2_AUTHORIZER_URL}/b2/upload-proxy`, true);

      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.setRequestHeader('x-upload-url', uploadUrl);

      // Forward only safe standard Content-Type to avoid AWS SigV4 signature mismatches
      const contentType =
        headers['Content-Type'] ||
        (fileOrBlob instanceof File || fileOrBlob instanceof Blob ? fileOrBlob.type : '') ||
        'application/octet-stream';
      if (contentType) {
        try {
          xhr.setRequestHeader('Content-Type', contentType);
        } catch {
          // ignore unsafe header sets
        }
      }

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            onProgress(evt.loaded, evt.total);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`B2 Upload Proxy failed: HTTP ${xhr.status} ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error('B2 Upload Proxy failed: Network or connection error.'));
      };

      xhr.ontimeout = () => {
        reject(new Error('B2 Upload Proxy failed: Request timed out.'));
      };

      xhr.send(fileOrBlob);
    });
  }

  /**
   * Executes direct browser-to-B2 upload via presigned S3 PUT URL with progress tracking.
   * Seamlessly falls back to authorizer streaming proxy if direct PUT encounters browser CORS or network issues.
   */
  static async executePresignedPut(
    uploadUrl: string,
    fileOrBlob: Blob | File,
    headers: Record<string, string> = {},
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void> {
    try {
      await this.executeDirectPut(uploadUrl, fileOrBlob, headers, onProgress);
    } catch (err: any) {
      const msg = err?.message || '';
      const isCorsOrNetwork = msg.includes('CORS') || msg.includes('Network') || msg.includes('Direct PUT failed');
      if (isCorsOrNetwork && B2_AUTHORIZER_URL) {
        console.warn('[B2Authorizer] Direct B2 PUT hit CORS or network error. Retrying via streaming upload proxy...');
        await this.executeProxyPut(uploadUrl, fileOrBlob, headers, onProgress);
        return;
      }
      throw err;
    }
  }

  /**
   * Internal direct browser-to-B2 XHR PUT.
   */
  private static async executeDirectPut(
    uploadUrl: string,
    fileOrBlob: Blob | File,
    headers: Record<string, string> = {},
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);

      // Apply signed headers from authorizer
      // Note: In AWS SigV4 presigned URLs, sending unsigned x-amz-* headers causes SignatureDoesNotMatch
      let signedSet: Set<string> | null = null;
      try {
        const parsedUrl = new URL(uploadUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
        const signedParam = parsedUrl.searchParams.get('X-Amz-SignedHeaders');
        if (signedParam) {
          signedSet = new Set(signedParam.toLowerCase().split(';'));
        }
      } catch {
        // ignore url parsing error
      }

      Object.entries(headers).forEach(([k, v]) => {
        const lowerK = k.toLowerCase();
        if (!signedSet || signedSet.has(lowerK) || lowerK === 'content-type') {
          xhr.setRequestHeader(k, v);
        }
      });

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            onProgress(evt.loaded, evt.total);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`B2 Direct PUT failed: HTTP ${xhr.status} ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error('B2 Direct PUT failed: Network or CORS error occurred during upload.'));
      };

      xhr.ontimeout = () => {
        reject(new Error('B2 Direct PUT failed: Upload request timed out.'));
      };

      xhr.send(fileOrBlob);
    });
  }

  /**
   * Requests a scoped presigned DELETE authorization for compensating cleanup of an UNCOMMITTED candidate object.
   * Invariant: MUST NEVER be called on a finalized canonical CAS object indexed in contentHashes.
   */
  static async requestDeleteAuthorization(
    objectKey: string
  ): Promise<DeleteAuthorization> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to authorize candidate deletion.');
    }

    const token = await user.getIdToken();

    const response = await fetch(`${B2_AUTHORIZER_URL}/b2/delete-authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ objectKey }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Delete authorization failed: HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) errorMsg = errorJson.error;
      } catch {
        if (errorText) errorMsg = errorText;
      }
      throw new Error(errorMsg);
    }

    return (await response.json()) as DeleteAuthorization;
  }

  /**
   * Executes presigned DELETE for compensating cleanup of an UNCOMMITTED candidate object.
   * Invariant: MUST NEVER be called on a finalized canonical CAS object indexed in contentHashes.
   */
  static async executeDeleteCandidateObject(objectKey: string): Promise<void> {
    try {
      const authData = await this.requestDeleteAuthorization(objectKey);
      const res = await fetch(authData.deleteUrl, {
        method: authData.method || 'DELETE',
        headers: authData.headers || {},
      });
      if (!res.ok && res.status !== 404) {
        console.warn(`Compensating B2 candidate DELETE failed: HTTP ${res.status}`);
        await this.executeDeleteObject(objectKey);
      }
    } catch (err) {
      console.warn('Compensating B2 candidate DELETE encountered an error, falling back to direct delete:', err);
      await this.executeDeleteObject(objectKey);
    }
  }

  /**
   * Physically deletes an S3 object in Backblaze B2 upon file deletion to free user bucket storage.
   * Uses backend authorizer /b2/delete-object to execute directly server-side, bypassing browser CORS.
   */
  static async executeDeleteObject(objectKey: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) {
      console.warn('User not authenticated, skipping executeDeleteObject');
      return;
    }

    try {
      const token = await user.getIdToken();
      const res = await fetch(`${B2_AUTHORIZER_URL}/b2/delete-object`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ objectKey }),
      });

      if (!res.ok && res.status !== 404) {
        // Fallback to legacy presigned delete if endpoint returned 404/not implemented
        const authData = await this.requestDeleteAuthorization(objectKey);
        await fetch(authData.deleteUrl, {
          method: authData.method || 'DELETE',
          headers: authData.headers || {},
        });
      }
    } catch (err) {
      console.warn('B2 executeDeleteObject encountered an error:', err);
    }
  }

  /**
   * Physically purges an entire USB hardware source drive folder in Backblaze B2.
   * Purges all objects, version history, and delete markers under `backups/{vaultId}/{sourceId}/`.
   */
  static async executeDeleteDrive(
    vaultId: string,
    sourceId: string
  ): Promise<{ success: boolean; prefix: string; versionsPurged: number }> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to delete a drive.');
    }

    const token = await user.getIdToken();
    const res = await fetch(`${B2_AUTHORIZER_URL}/b2/delete-drive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ vaultId, sourceId }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errorMsg = `Drive deletion failed: HTTP ${res.status}`;
      try {
        const json = JSON.parse(errText);
        if (json.error || json.message) errorMsg = json.message || json.error;
      } catch {
        if (errText) errorMsg = errText;
      }
      throw new Error(errorMsg);
    }

    return await res.json();
  }

  /**
   * Executes a full vault-wide purge in Backblaze B2, permanently deleting all files and versions,
   * while preserving system metadata.
   */
  static async executeWipeVault(
    vaultId: string
  ): Promise<{ success: boolean; vaultId: string; versionsPurged: number }> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to wipe vault storage.');
    }

    const token = await user.getIdToken();
    const res = await fetch(`${B2_AUTHORIZER_URL}/b2/wipe-vault`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ vaultId }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errorMsg = `Vault wipe failed: HTTP ${res.status}`;
      try {
        const json = JSON.parse(errText);
        if (json.error || json.message) errorMsg = json.message || json.error;
      } catch {
        if (errText) errorMsg = errText;
      }
      throw new Error(errorMsg);
    }

    return await res.json();
  }

  /**
   * Registers the current authenticated Google user to the authorizer pending approval list.
   */
  static async registerUser(userProfile?: { displayName?: string; photoURL?: string }): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const token = await user.getIdToken();
      await fetch(`${B2_AUTHORIZER_URL}/b2/register-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          displayName: userProfile?.displayName || user.displayName || '',
          photoURL: userProfile?.photoURL || user.photoURL || '',
        }),
      });
    } catch (err) {
      console.warn('Failed to register user to authorizer pending list:', err);
    }
  }

  /**
   * Fetches pending users from the authorizer backend.
   */
  static async listPendingUsers(): Promise<Array<{ uid: string; email: string; displayName: string; photoURL?: string; registeredAt: number }>> {
    const user = auth.currentUser;
    if (!user) return [];

    try {
      const token = await user.getIdToken();
      const res = await fetch(`${B2_AUTHORIZER_URL}/b2/list-pending-users`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.users || [];
    } catch {
      return [];
    }
  }

  /**
   * Physically moves / renames an object in Backblaze B2 to match directory structure changes.
   */
  static async moveObject(
    sourceObjectKey: string,
    destinationObjectKey: string
  ): Promise<void> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to move B2 objects.');
    }

    const token = await user.getIdToken();
    const response = await fetch(`${B2_AUTHORIZER_URL}/b2/move-object`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sourceObjectKey,
        destinationObjectKey,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`B2 moveObject warning: HTTP ${response.status}: ${errText}`);
    }
  }

  /**
   * Physically copies an object in Backblaze B2 (S3 CopyObject) to match directory structure changes.
   */
  static async copyObject(
    sourceObjectKey: string,
    destinationObjectKey: string
  ): Promise<void> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to copy B2 objects.');
    }

    const token = await user.getIdToken();
    const response = await fetch(`${B2_AUTHORIZER_URL}/b2/copy-object`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sourceObjectKey,
        destinationObjectKey,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`B2 copyObject warning: HTTP ${response.status}: ${errText}`);
    }
  }
}
