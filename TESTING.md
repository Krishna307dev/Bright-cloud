# Testing Strategy

## Unit tests

Test without Android hardware:

-   filename splitting
-   `(1)` version generation
-   collision handling
-   SHA-256 calculation
-   duplicate decisions
-   state transitions
-   retry classification
-   path normalization

## Integration tests

Test with Firebase emulator/services where practical:

-   upload
-   metadata write
-   duplicate hash lookup
-   security rules
-   transaction conflicts

## Physical device tests

Required USB matrix:

-   at least two different USB drives
-   different capacities
-   different filesystems if the phone supports them
-   USB drive with thousands of files
-   nested directories
-   Unicode filenames
-   spaces
-   long filenames
-   files without extensions
-   multiple dots
-   duplicate content with different names
-   changed file with same name
-   USB removal during scan
-   USB removal during hashing
-   USB removal during upload
-   network off during upload
-   phone reboot with pending work
-   app process killed during upload

## Versioning test

Start with:

``` text
CHAPTER_5.pdf
```

Then upload changed content repeatedly.

Expected:

``` text
CHAPTER_5.pdf
CHAPTER_5(1).pdf
CHAPTER_5(2).pdf
CHAPTER_5(3).pdf
```

## Deduplication test

Copy identical bytes under different names:

``` text
A.pdf
B.pdf
```

Expected only one cloud content object if global content deduplication
is enabled.

## Crash tests

Kill the process at:

-   after hashing
-   after filename reservation
-   during upload
-   after upload before DB finalization

The system must reconcile without data loss or duplicate version
explosion.

## OEM tests

At minimum test the actual phone used for development plus one different
Android/OEM device if available.
