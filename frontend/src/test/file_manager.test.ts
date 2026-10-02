import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZipService, type FileToZip } from '../services/zipService';
import { B2AuthorizerClient } from '../services/b2Authorizer';

vi.mock('../services/b2Authorizer', () => ({
  B2AuthorizerClient: {
    requestDownloadAuthorization: vi.fn(),
  },
}));

describe('File Manager & 0-Compression ZIP Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an uncompressed ZIP using STORE compression mode', async () => {
    vi.spyOn(B2AuthorizerClient, 'requestDownloadAuthorization').mockResolvedValue({
      downloadUrl: 'https://b2.mock/test.txt',
      expiresAt: '2026-09-30T12:00:00Z',
      fileId: 'file-1',
      storedName: 'test.txt',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['Hello World Content'], { type: 'text/plain' }),
    } as any);

    const files: FileToZip[] = [
      { name: 'test.txt', vaultId: 'vault-1', fileId: 'file-1' },
    ];

    const zipBlob = await ZipService.createZeroCompressionZip(files);
    expect(zipBlob).toBeDefined();
    expect(zipBlob.size).toBeGreaterThan(0);
    // ZIP magic bytes: PK (0x50, 0x4B)
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(zipBlob);
    });
    const bytes = new Uint8Array(arrayBuffer);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});
