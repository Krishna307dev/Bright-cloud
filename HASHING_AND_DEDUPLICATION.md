# SHA-256 and Deduplication

## Hash algorithm

Use SHA-256.

Do not use filename, timestamp, or size as the identity of file content.

## Streaming algorithm

Conceptually:

``` text
MessageDigest = SHA-256
open input stream
repeat:
    read buffer
    update digest
until EOF
digest()
```

Recommended buffer size should be benchmarked rather than blindly
optimized.

## Deduplication rule

The exact content hash is the strongest deduplication identity.

Decision:

``` text
hash exists in CloudFileIndex?
    YES -> SKIP upload
    NO  -> continue
```

This is global content deduplication, not merely per-filename
deduplication.

## Changed file

Example:

``` text
Cloud:
CHAPTER_5.pdf
hash=A

USB:
CHAPTER_5.pdf
hash=B

A != B
```

Result:

``` text
CHAPTER_5.pdf
CHAPTER_5(1).pdf
```

If hash B already exists elsewhere in the cloud, do not upload a
duplicate copy merely because the current USB filename differs.

## Hash collision policy

SHA-256 collisions are not expected for normal personal backup use.
Still, cloud metadata should retain size and optionally a secondary
consistency check.

Do not claim cryptographic impossibility.

## Partial hash

Never insert a hash into the global completed-content index before
hashing has completed successfully.
