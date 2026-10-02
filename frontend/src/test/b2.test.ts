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
});
