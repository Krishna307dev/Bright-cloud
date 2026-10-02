# Backup State Machine

```text
                               DISCOVERED
                                    │
                ┌───────────────────┴───────────────────┐
                ▼                                       ▼
    Category A (Automatic Policy)           Category B (Metadata-Only)
                │                                       │
                ▼                                       ▼
             HASHING                            METADATA_INDEXED
                │                                       │
                ▼                                       │ (User clicks "BACKUP TO CLOUD"
             HASHED                                     │  in Web Viewer)
                │                                       ▼
      ┌─────────┴─────────┐                      requestStatus = "REQUESTED"
      ▼                   ▼                             │
(Hash exists)       (Hash is new)                       │ (USB connected)
      │                   │                             ▼
SKIPPED_DUPLICATE   NAME_RESERVATION                 HASHING
                          │                             │
                          ▼                             ▼
                      UPLOADING                      HASHED
                     /    │    \                        │
                    /     │     \                       ▼
               success  retry   permanent        (Same Upload Pipeline)
                  │       │         │                   │
                  ▼       v         ▼                   ▼
         UPLOADED_NOT_INDEXED RETRY_WAIT FAILED       INDEXED
                  │
                  ▼ (Atomic Firestore Commit)
               INDEXED
```

---

## State Transition Definitions

| State | Scope | Description |
|---|---|---|
| `DISCOVERED` | Local (Room) | File path and filesystem metadata detected on USB drive. |
| `METADATA_INDEXED` | Local & Cloud | Category B file indexed in Firestore without binary byte upload. |
| `HASHING` | Local (Room) | 64 KB buffer streaming SHA-256 calculation in progress. |
| `HASHED` | Local (Room) | SHA-256 computation complete; awaiting deduplication check. |
| `SKIPPED_DUPLICATE` | Local & Cloud | Content hash already exists in Firestore `contentHashes`; no byte upload required. |
| `NAME_RESERVING` | Local & Cloud | Acquiring atomic version reservation (`basename(N).ext`) in Firestore `nameReservations`. |
| `NAME_RESERVED` | Local & Cloud | Atomic reservation acquired with 24-hour TTL lock. |
| `UPLOADING` | Local & Backblaze B2 | Streaming byte transfer to Backblaze B2 object key with `x-amz-meta-sha256`. |
| `UPLOADED_NOT_INDEXED` | Local (Room) | B2 object confirmed; awaiting atomic Firestore metadata finalization. |
| `INDEXED` | Local & Cloud | Firestore `files`, `contentHashes`, and `nameReservations` COMMITTED; backup complete. |
| `SOURCE_UNAVAILABLE` | Local (Room) | USB drive detached or I/O failure during operation. Resumes upon reconnect. |
| `FAILED` | Local (Room) | Non-retryable error or maximum retry attempts exceeded. |

---

## Core Invariant Rules

1. **Byte-for-Byte Fidelity**: Uploaded files to Backblaze B2 are never compressed or transcoded.
2. **Never transition to `INDEXED` before B2 confirmation and Firestore transaction commit.**
3. **Never delete or modify source files on the USB drive.**
4. **Existing B2 objects are never overwritten.** Changed same-name files receive a versioned name.
5. **Exact SHA-256 content is never uploaded twice for the same owner.**
6. **Smart Backup Policy**: Category A files upload automatically; Category B files index metadata first and upload bytes only upon user request.
7. **Recovery logic is idempotent and safe to execute multiple times.**
