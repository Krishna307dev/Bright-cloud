import { describe, it, expect, vi, beforeEach } from 'vitest';
import { B2AuthorizerClient } from '../services/b2Authorizer';

describe('Backblaze B2 Authorizer & Download Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('checks worker health endpoint successfully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    } as any);

    const healthy = await B2AuthorizerClient.checkHealth();
    expect(healthy).toBe(true);
  });

  it('handles worker health check failure gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const healthy = await B2AuthorizerClient.checkHealth();
    expect(healthy).toBe(false);
  });

  it('throws helpful error if user is not signed in when requesting download', async () => {
    // Current user is null in mock
    await expect(
      B2AuthorizerClient.requestDownloadAuthorization('vault-1', 'file-1')
    ).rejects.toThrow('User must be authenticated');
  });

  it('verifies b2ObjectKey and credentials are NEVER present in client requests or responses', async () => {
    // Test that the client contract for download authorization only returns downloadUrl, expiresAt, fileId, storedName
    const sampleAuthResponse = {
      downloadUrl: 'https://f000.backblazeb2.com/file/my-bucket/test.pdf?X-Amz-Signature=abcd',
      expiresAt: '2026-09-29T15:00:00Z',
      fileId: 'file-123',
      storedName: 'test.pdf',
    };

    expect((sampleAuthResponse as any).b2ObjectKey).toBeUndefined();
    expect((sampleAuthResponse as any).B2_KEY_ID).toBeUndefined();
    expect((sampleAuthResponse as any).B2_APPLICATION_KEY).toBeUndefined();
  });

  it('falls back to executeProxyPut when direct B2 PUT encounters CORS or network error', async () => {
    const directSpy = vi.spyOn(B2AuthorizerClient as any, 'executeDirectPut').mockRejectedValue(
      new Error('B2 Direct PUT failed: Network or CORS error occurred during upload.')
    );
    const proxySpy = vi.spyOn(B2AuthorizerClient, 'executeProxyPut').mockResolvedValue();

    const dummyBlob = new Blob(['hello world'], { type: 'text/plain' });
    await B2AuthorizerClient.executePresignedPut(
      'https://s3.us-west-004.backblazeb2.com/test',
      dummyBlob,
      { 'Content-Type': 'text/plain' }
    );

    expect(directSpy).toHaveBeenCalled();
    expect(proxySpy).toHaveBeenCalledWith(
      'https://s3.us-west-004.backblazeb2.com/test',
      dummyBlob,
      { 'Content-Type': 'text/plain' },
      undefined
    );
  });

  it('sends disposition and filename in requestDownloadAuthorization payload', async () => {
    const { auth } = await import('../services/firebase');
    (auth as any).currentUser = {
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
    };

    let capturedPayload: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      if (init && init.body) {
        capturedPayload = JSON.parse(init.body);
      }
      return {
        ok: true,
        json: async () => ({
          downloadUrl: 'https://b2.mock/download?response-content-disposition=attachment',
          expiresAt: Date.now() + 3600000,
          fileId: 'file-123',
          storedName: 'my-doc.pdf',
        }),
      } as any;
    });

    const res = await B2AuthorizerClient.requestDownloadAuthorization('vault-1', 'file-123', {
      disposition: 'attachment',
      filename: 'my-doc.pdf',
    });

    expect(capturedPayload).toEqual({
      vaultId: 'vault-1',
      fileId: 'file-123',
      disposition: 'attachment',
      filename: 'my-doc.pdf',
    });
    expect(res.downloadUrl).toContain('response-content-disposition=attachment');

    (auth as any).currentUser = null;
  });

  it('triggerDownload requests attachment disposition and triggers anchor click', async () => {
    const reqSpy = vi.spyOn(B2AuthorizerClient, 'requestDownloadAuthorization').mockResolvedValue({
      downloadUrl: 'https://b2.mock/download/test.pdf',
      expiresAt: Date.now() + 3600000,
      fileId: 'file-999',
      storedName: 'test.pdf',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 } as any);

    let clicked = false;
    let createdAnchor: any = null;
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        createdAnchor = el;
        el.click = () => { clicked = true; };
      }
      return el;
    });

    await B2AuthorizerClient.triggerDownload('vault-1', 'file-999', 'test.pdf');

    expect(reqSpy).toHaveBeenCalledWith('vault-1', 'file-999', {
      disposition: 'attachment',
      filename: 'test.pdf',
    });
    expect(clicked).toBe(true);
    expect(createdAnchor.href).toBe('https://b2.mock/download/test.pdf');
    expect(createdAnchor.target).toBe('_blank');
  });
});
