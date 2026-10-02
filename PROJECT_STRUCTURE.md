# Project Structure

## Proposed repository tree

``` text
USBCloudBackup/
├── .gitignore
├── README.md
├── PROJECT_STRUCTURE.md
├── ARCHITECTURE.md
├── REQUIREMENTS.md
├── ANDROID_APIS.md
├── USB_STORAGE.md
├── FILE_DISCOVERY.md
├── HASHING_AND_DEDUPLICATION.md
├── VERSIONING_AND_NAMING.md
├── CLOUD_BACKEND.md
├── BACKGROUND_EXECUTION.md
├── PERMISSIONS.md
├── DATA_MODEL.md
├── STATE_MACHINE.md
├── ERROR_HANDLING.md
├── SECURITY.md
├── OFFLINE_AND_RETRY.md
├── TESTING.md
├── BUILD_AND_TOOLCHAIN.md
├── PUBLIC_APIS.md
├── AGENT_RULES.md
├── IMPLEMENTATION_PLAN.md
├── CHANGELOG.md
├── docs/
│   ├── decisions/
│   ├── research/
│   └── test-results/
└── app/
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/.../
        │   ├── bootstrap/
        │   ├── usb/
        │   ├── storage/
        │   ├── scanning/
        │   ├── hashing/
        │   ├── backup/
        │   ├── cloud/
        │   ├── database/
        │   ├── workers/
        │   ├── receivers/
        │   ├── permissions/
        │   ├── auth/
        │   └── setup/
        └── res/
```

## Package responsibilities

### bootstrap

Application initialization, dependency wiring, process-safe startup.

### usb

USB attach/detach detection, device identity, permission handling, USB
host integration.

### storage

Document/URI access abstractions, stream opening, file metadata
extraction.

### scanning

Recursive directory traversal, filtering, symlink/loop protection, file
snapshot creation.

### hashing

Streaming SHA-256 computation. Never load an entire large file into RAM.

### backup

Business logic that converts a scanned file into a
deduplication/versioning/upload decision.

### cloud

Firebase Storage and Firestore adapters. Keep Firebase-specific code
behind interfaces where practical.

### database

Room entities, DAOs, migrations, local persistent queue and state.

### workers

WorkManager workers for scan, hash, upload, reconciliation, and retry.

### receivers

Manifest-declared system event receivers such as USB device attachment
and boot/package replacement where justified.

### permissions

Centralized permission/feature checks. No scattered permission logic.

### auth

First-run authentication/bootstrap state only. No public
account-management UI.

### setup

Minimal first-run Activity. It should not become a dashboard.
