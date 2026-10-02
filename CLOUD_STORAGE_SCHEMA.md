# Backblaze B2 Storage Schema

## Canonical Object Path

All binary files uploaded to Backblaze B2 are stored using S3-compatible object keys with the following canonical path:

```text
backups/{uid}/{sourceId}/{relativePath}{storedName}
```

### Components

| Component | Description | Example |
|-----------|-------------|---------|
| `backups/` | Fixed root prefix | `backups/` |
| `{uid}` | Firebase Auth User ID | `abc123def456` |
| `{sourceId}` | USB device fingerprint | `1234-5678-SN001` |
| `{relativePath}` | Directory path from USB root, ending with `/` | `Notes/Math/` |
| `{storedName}` | Final filename (may be versioned) | `CHAPTER_5.pdf` or `CHAPTER_5(1).pdf` |

### Full Path Examples

```text
backups/abc123def456/1234-5678-SN001/CHAPTER_5.pdf
backups/abc123def456/1234-5678-SN001/CHAPTER_5(1).pdf
backups/abc123def456/1234-5678-SN001/Notes/Math/CHAPTER_5.pdf
backups/abc123def456/1234-5678-SN001/Notes/Math/homework.docx
backups/abc123def456/9999-AAAA-SN002/photos/vacation.jpg
```

### Root-Level Files

Files located directly in the root directory of the USB drive have an empty `relativePath`:

```text
backups/abc123def456/1234-5678-SN001/README.txt
```

---

## Byte-for-Byte Fidelity Requirement

- **Zero Compression**: Files must not be compressed or re-compressed during transfer or storage.
- **Zero Transcoding**: Media files (images, audio) must not undergo format conversion, downsampling, or metadata stripping.
- **Zero Byte Modification**: The uploaded byte stream in Backblaze B2 must match the USB source file byte-for-byte (`SHA-256(B2_Object) == SHA-256(USB_Source)`).

---

## Source ID Structure

The source ID uniquely identifies a physical USB device:

```text
{vendorId}-{productId}-{serialOrFallback}
```

- `vendorId`: `UsbDevice.getVendorId()` as decimal string.
- `productId`: `UsbDevice.getProductId()` as decimal string.
- `serialOrFallback`: `UsbDevice.getSerialNumber()` if available; otherwise SHA-256(manufacturer + productName) truncated to 8 hex characters.

Example: `1234-5678-SN001` or `1234-5678-a1b2c3d4`

---

## Filename Encoding and Versioning

- `storedName` preserves the original filename unless a collision occurs with different content.
- Versioned format: `<basename>(<version>).<extension>`
- Version numbering begins at 1 and increments atomically:
  - Version 0 (original): `CHAPTER_5.pdf`
  - Version 1: `CHAPTER_5(1).pdf`
  - Version 2: `CHAPTER_5(2).pdf`
- Extensionless files: `README` -> `README(1)`
- Multi-dot files: `archive.tar.gz` -> `archive.tar(1).gz`

---

## S3 Metadata Headers on Upload

Uploaded objects carry custom metadata headers for durable crash recovery and cloud-side validation:

```text
x-amz-meta-sha256: <64-char lowercase hex>
x-amz-meta-source-id: <sourceId>
x-amz-meta-original-name: <original USB filename>
x-amz-meta-file-id: <Firestore file document ID>
```
