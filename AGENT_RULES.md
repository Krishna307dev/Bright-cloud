# AI Coding Agent Rules

## Mission

Build the private USBCloudBackup Android application according to the
documentation in this repository.

## Before coding

Read:

1.  README.md
2.  REQUIREMENTS.md
3.  ARCHITECTURE.md
4.  ANDROID_APIS.md
5.  USB_STORAGE.md
6.  HASHING_AND_DEDUPLICATION.md
7.  VERSIONING_AND_NAMING.md
8.  BACKGROUND_EXECUTION.md
9.  DATA_MODEL.md
10. SECURITY.md
11. TESTING.md
12. IMPLEMENTATION_PLAN.md

## Hard rules

-   Do not add a dashboard.
-   Do not add unnecessary UI.
-   Do not add polling.
-   Do not use hidden Android APIs.
-   Do not use reflection to bypass Android restrictions.
-   Do not assume USB storage is a normal java.io.File.
-   Do not upload a whole file into RAM.
-   Do not overwrite an existing cloud object.
-   Do not use filename alone for deduplication.
-   Do not mark an upload complete before confirmation.
-   Do not store cloud secrets in the APK.
-   Do not make Firebase data public.
-   Do not create a permanent foreground service just to wait for USB.
-   Do not silently broaden the app into a public multi-user product.

## Required implementation behavior

Hash first.

Then:

``` text
hash exists -> skip
hash new + name free -> original name
hash new + name occupied -> next version suffix
```

## Research before implementation

If an Android behavior is uncertain, inspect the current official
Android API documentation before coding.

If a Firebase behavior is uncertain, inspect current official Firebase
documentation.

Do not invent an API.

## Change discipline

Before modifying architecture, explain:

-   why the current approach is insufficient;
-   which platform restriction requires the change;
-   what files are affected;
-   how tests will prove the change.

## Testing requirement

Every non-trivial business rule must have tests.

## Documentation requirement

When implementation behavior changes, update the relevant `.md` file in
the same change.

## No fake completion

Never claim a feature works until it has been built/tested at the
appropriate level.

Distinguish:

-   implemented
-   unit-tested
-   emulator-tested
-   physical-device-tested
-   not yet verified
