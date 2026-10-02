import JSZip from 'jszip';
import { B2AuthorizerClient } from './b2Authorizer';

export interface FileToZip {
  name: string;
  vaultId: string;
  fileId: string;
}

export class ZipService {
  /**
   * Generates a 0-compression (STORE) ZIP archive in browser memory.
   * Guarantees zero server CPU load and near-instant packaging.
   */
  static async createZeroCompressionZip(
    files: FileToZip[],
    onProgress?: (percent: number, currentFileName: string) => void
  ): Promise<Blob> {
    const zip = new JSZip();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (onProgress) {
        onProgress(Math.round((i / files.length) * 100), f.name);
      }

      // Request presigned download URL
      const auth = await B2AuthorizerClient.requestDownloadAuthorization(f.vaultId, f.fileId);
      let blob: Blob;
      try {
        const res = await fetch(auth.downloadUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
      } catch (err) {
        // Direct B2 fetch hit CORS; fallback through Cloudflare Authorizer streaming download proxy
        const authorizerUrl = import.meta.env.VITE_B2_AUTHORIZER_URL || 'http://localhost:8787';
        const proxyUrl = `${authorizerUrl}/b2/download-proxy?downloadUrl=${encodeURIComponent(auth.downloadUrl)}`;
        const proxyRes = await fetch(proxyUrl);
        if (!proxyRes.ok) {
          throw new Error(`Failed to download ${f.name} for archive packaging (HTTP ${proxyRes.status})`);
        }
        blob = await proxyRes.blob();
      }

      // compression: "STORE" ensures 0 compression / uncompressed store
      zip.file(f.name, blob, { compression: 'STORE' });
    }

    if (onProgress) {
      onProgress(100, 'Packing archive...');
    }

    return await zip.generateAsync({
      type: 'blob',
      compression: 'STORE',
    });
  }

  /**
   * Packs selected files into a 0-compression ZIP and triggers native browser download.
   */
  static async downloadAsZip(
    files: FileToZip[],
    zipFilename = 'vault_export.zip',
    onProgress?: (percent: number, currentFileName: string) => void
  ): Promise<void> {
    const zipBlob = await this.createZeroCompressionZip(files, onProgress);
    const blobUrl = URL.createObjectURL(zipBlob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = zipFilename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  }
}
