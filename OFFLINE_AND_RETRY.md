# Offline and Retry Strategy

## Core rule

USB backup should not fail permanently just because the internet is
unavailable.

Pipeline:

``` text
USB
 |
scan
 |
hash
 |
local queue
 |
network unavailable
 |
WAIT
 |
network returns
 |
upload
```

## Local durability

The metadata and queue must survive:

-   process death
-   reboot
-   temporary network failure
-   USB disconnect

Do not keep the only copy of the queue in memory.

## WorkManager constraints

Use network constraints for upload work.

## Upload interruption

If the Firebase SDK upload task can be resumed safely, use the
documented SDK behavior.

If a process dies, the application must reconcile whether an object was
already created before attempting another upload.

The SHA-256 metadata and object path should make the finalization
operation idempotent.

## Duplicate after crash

Potential sequence:

``` text
upload succeeds
process dies
local DB still says UPLOADING
```

Recovery must check cloud state before blindly creating another version.

Never produce:

``` text
CHAPTER_5(1).pdf
CHAPTER_5(2).pdf
```

merely because the app crashed after a successful upload.
