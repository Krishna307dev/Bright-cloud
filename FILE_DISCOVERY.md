# File Discovery

## Scanner responsibilities

The scanner converts a source tree into deterministic file snapshots.

A snapshot should contain:

``` text
sourceId
relativePath
displayName
extension
size
lastModified
mimeType
sourceReference
```

## Deterministic traversal

Use a stable ordering when practical, for example lexicographical
relative path order. This makes logs and tests reproducible.

## Directories

Do not upload empty directories unless explicitly required.

A directory exists in cloud storage conceptually through its files and
metadata.

## Unsupported entries

Record and skip entries that cannot be read rather than crashing the
entire backup.

## Large files

The scanner should not read file contents.

Content hashing belongs to the hashing stage.

## Race conditions

A file may change while being scanned or hashed.

At minimum capture metadata before hashing and verify metadata after
hashing when the provider supports it.

If size/modified timestamp changes during processing, re-read/hash
according to a safe consistency policy.

## Filename normalization

Do not silently destroy user filenames.

Sanitize only characters that the cloud storage path cannot safely
represent or that create security ambiguity.

Keep the original display name in metadata even if a safe stored path is
required.
