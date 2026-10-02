import { describe, it, expect } from "vitest";
import { createB2PresignedUrl, SigV4Config } from "../src/sigv4";

describe("AWS SigV4 Presigned URL Generator for Backblaze B2 S3", () => {
  const config: SigV4Config = {
    endpoint: "https://s3.eu-central-003.backblazeb2.com",
    keyId: "b2_key_id_12345",
    applicationKey: "b2_app_key_secret_1234567890abcdef",
    bucketName: "BrightCloud",
    region: "eu-central-003"
  };

  it("generates a valid AWS4-HMAC-SHA256 presigned PUT URL for Backblaze B2", async () => {
    const objectKey = "backups/user_123/src-1/large_video.mp4";
    const headers = {
      "x-amz-meta-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "x-amz-meta-source-id": "src-1",
      "x-amz-meta-original-name": "large_video.mp4",
      "x-amz-meta-file-id": "100"
    };

    const urlStr = await createB2PresignedUrl(config, {
      method: "PUT",
      objectKey,
      expiresInSeconds: 3600,
      headers
    });

    const url = new URL(urlStr);
    expect(url.hostname).toBe("s3.eu-central-003.backblazeb2.com");
    expect(url.pathname).toContain("BrightCloud");
    expect(url.pathname).toContain("large_video.mp4");

    const params = url.searchParams;
    expect(params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(params.get("X-Amz-Credential")).toContain("b2_key_id_12345");
    expect(params.get("X-Amz-Credential")).toContain("eu-central-003/s3/aws4_request");
    expect(params.get("X-Amz-Expires")).toBe("3600");
    expect(params.get("X-Amz-SignedHeaders")).toContain("host");
    expect(params.get("X-Amz-SignedHeaders")).toContain("x-amz-meta-sha256");
    expect(params.get("X-Amz-SignedHeaders")).toContain("x-amz-meta-source-id");
    expect(params.get("X-Amz-Signature")).toBeDefined();
    expect(params.get("X-Amz-Signature")!.length).toBe(64);
  });

  it("generates a valid presigned HEAD URL for Backblaze B2 object checks", async () => {
    const objectKey = "backups/user_123/src-1/large_video.mp4";
    const urlStr = await createB2PresignedUrl(config, {
      method: "HEAD",
      objectKey,
      expiresInSeconds: 1800
    });

    const url = new URL(urlStr);
    expect(url.hostname).toBe("s3.eu-central-003.backblazeb2.com");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("1800");
    expect(url.searchParams.get("X-Amz-Signature")).toBeDefined();
  });
});
