# Functional Requirements

## FR-001 First-run setup

The first launch may show a minimal white setup screen.

The app must initialize required services and request only genuinely
required permissions/authorization.

After successful setup, normal operation must not require opening the
Activity.

## FR-002 USB detection

Detect supported USB mass-storage devices when attached while the phone
is acting as USB host.

Do not treat arbitrary USB peripherals as backup sources.

## FR-003 Device identity

Persist a stable best-effort identity for each physical USB device.

Store available identifiers such as:

-   manufacturer
-   product
-   vendor ID
-   product ID
-   serial number when exposed
-   USB device path/name when useful
-   filesystem/volume identity when available

Do not assume every device exposes a serial number.

## FR-004 Recursive scan

Traverse all accessible directories recursively.

Do not follow unsupported links or create infinite traversal loops.

Capture:

-   relative path
-   original filename
-   extension
-   size
-   last modified timestamp when available
-   MIME type when available
-   source device identity
-   source URI/path representation

## FR-005 SHA-256

Calculate SHA-256 using streaming I/O.

Hash equality means identical bytes for the compared content.

## FR-006 Global exact-content deduplication

Before uploading, check whether the same SHA-256 already exists in the
cloud index.

If the exact hash exists, skip upload even if the filename is different.

## FR-007 Same-name changed-file versioning

If the SHA-256 is new and the desired stored filename already exists,
create:

``` text
name.ext
name(1).ext
name(2).ext
name(3).ext
```

Never overwrite an existing file.

## FR-008 Directory preservation

Preserve the source directory structure where possible.

Example:

``` text
USB:
Notes/Math/CHAPTER_5.pdf

Cloud:
USB/<device-id>/Notes/Math/CHAPTER_5.pdf
```

Versioning occurs at the filename level within that directory.

## FR-009 Crash safety

Never mark a file as successfully uploaded before cloud confirmation.

## FR-010 Retry

Transient failures must retry using durable WorkManager/database state.

Permanent failures must be recorded with enough diagnostic information
to understand the failure later.

## FR-011 USB removal

If the USB device disappears during hashing/upload, stop safely and
leave the job resumable where possible.

Do not corrupt the queue.

## FR-012 No continuous UI

The normal path must not depend on the Activity.

## FR-013 Boot resilience

After reboot, the app must restore durable state and pending work using
Android-supported mechanisms.

## FR-014 Private deployment

The architecture may assume one private owner/account. Do not add
multi-user SaaS features unless explicitly requested.
