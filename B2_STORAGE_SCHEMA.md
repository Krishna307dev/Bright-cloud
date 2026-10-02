# Backblaze B2 Storage Schema

## Canonical Object Path

```text
backups/{vaultId}/{sourceId}/{relativePath}{storedName}
```

### Components

| Component | Description | Example |
|-----------|-------------|--------|
| `backups/` | Fixed root prefix | `backups/` |
| `{vaultId}` | Shared Vault ID (Configured server-side) | `default` |
| `{sourceId}` | Physical USB device fingerprint | `0781-5583-8F12-3456` |
| `{relativePath}` | Relative directory from USB root, ending with `/` | `Photos/2026/` |
| `{storedName}` | Final stored filename (original or versioned) | `IMG_001.jpg` or `IMG_001(1).jpg` |

---

## Backblaze B2 S3 Metadata Headers

Every uploaded object to Backblaze B2 S3 carries custom metadata headers:

| S3 Header | Type | Description |
|-----------|------|-------------|
| `x-amz-meta-sha256` | String (64-char hex) | SHA-256 content checksum |
| `x-amz-meta-source-id` | String | Source USB hardware fingerprint |
| `x-amz-meta-original-name` | String | Original filename on USB storage |
| `x-amz-meta-file-id` | String | Local Room / Firestore file ID |

---

## Production Bucket Configuration

- **Provider**: Backblaze B2
- **Bucket**: `BrightCloud`
- **S3 Endpoint**: `https://s3.eu-central-003.backblazeb2.com`
- **Region**: `eu-central-003`
- **Bucket Type**: Private
- **Server-Side Encryption**: Enabled
- **Object Lock**: Disabled
