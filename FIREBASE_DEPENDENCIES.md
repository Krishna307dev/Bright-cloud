# Firebase & Cloud Backend Dependencies

## Decision

Use Firebase Android BoM `34.17.0` with **main modules only** (`firebase-auth` and `firebase-firestore`, no deprecated `-ktx` suffixes) for authentication and metadata. Backblaze B2 serves as the binary object storage backend accessed via S3-compatible APIs.

---

## Firebase BoM Version

```text
Pinned Version: 34.17.0
```

Pin to a specific version in `gradle/libs.versions.toml`. Do not use `+` or dynamic range selectors.

---

## Dependency Modules

### `gradle/libs.versions.toml`

```toml
[versions]
firebase-bom = "34.17.0"

[libraries]
firebase-bom = { group = "com.google.firebase", name = "firebase-bom", version.ref = "firebase-bom" }
firebase-auth = { group = "com.google.firebase", name = "firebase-auth" }
firebase-firestore = { group = "com.google.firebase", name = "firebase-firestore" }
```

---

## Backend Roles

| Service | Artifact / SDK | Purpose | Notes |
|---|---|---|---|
| **Firebase Auth** | `com.google.firebase:firebase-auth` | User identity (Anonymous & Email) | Coroutine support (`.await()`), UID scoping |
| **Cloud Firestore** | `com.google.firebase:firebase-firestore` | Metadata, SHA-256 index, reservations, job state, on-demand backup requests | ACID transactions, offline persistence, compound queries |
| **Backblaze B2** | S3-Compatible Client / REST | Physical binary file byte storage | Direct SigV4 Presigned streaming, BrightCloud private bucket, byte-for-byte fidelity |

---

## Gradle Plugins

```kotlin
// build.gradle.kts (root)
plugins {
    id("com.google.gms.google-services") version "4.4.2" apply false
}
```

The `google-services` plugin processes `google-services.json` and injects Firebase configuration into the build.
