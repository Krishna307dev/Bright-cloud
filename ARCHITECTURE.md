# Architecture

## Architecture style

Use an event-driven, persistent, crash-resilient pipeline.

``` text
USB ATTACHED
    |
    v
UsbReceiver
    |
    v
UsbDeviceCoordinator
    |
    v
USB permission / access
    |
    v
StorageAccessAdapter
    |
    v
FileScanner
    |
    v
FileSnapshot
    |
    v
SHA256Hasher
    |
    v
BackupDecisionEngine
    |
    +---- EXACT HASH EXISTS ----> SKIP
    |
    +---- HASH NEW + NAME FREE --> ORIGINAL NAME
    |
    +---- HASH NEW + NAME EXISTS -> NEXT VERSION NAME
                                      |
                                      v
                                  Local Queue
                                      |
                                      v
                                  WorkManager
                                      |
                                      v
                              Firebase Storage
                                      |
                                      v
                                  Firestore
```

## Layering rule

Do not let Android framework classes leak throughout the business layer.

Prefer:

``` text
Android USB APIs
      ↓
UsbGateway
      ↓
domain interfaces
      ↓
BackupDecisionEngine
      ↓
CloudRepository
```

This makes unit testing possible without a physical USB drive.

## Event-driven, not polling

Do not implement:

``` text
while(true) {
    checkUsb()
    sleep(...)
}
```

Use Android USB attach/detach events and WorkManager for durable work.

## Process death

Every important operation must be restartable.

The app must assume:

-   process can be killed;
-   phone can reboot;
-   network can disappear;
-   USB can be disconnected;
-   upload can fail;
-   storage can become unavailable;
-   a worker can be retried;
-   the same USB event can be observed more than once.

All operations must therefore be idempotent or protected by durable
state.

## Separation of concerns

The scanner finds files.

The hasher calculates hashes.

The decision engine decides whether to skip or upload.

The naming service chooses the stored name.

The cloud repository uploads.

The database records durable state.

No single class should do all of these jobs.
