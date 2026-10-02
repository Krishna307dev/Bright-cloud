# Public APIs Research and Usage Policy

## Important clarification

The GitHub `public-apis/public-apis` repository is a catalog of publicly
available Internet APIs. It is useful for discovering external web APIs,
but it is NOT the authoritative source for Android platform APIs.

This project should not depend on random APIs from that repository
unless a concrete feature actually requires an external web service.

## APIs that matter for this app

Primary platform/API sources:

### Android

-   Android USB Host APIs
-   Storage Access Framework
-   WorkManager
-   BroadcastReceiver
-   Room
-   Android cryptography APIs

### Firebase

-   Firebase Authentication
-   Cloud Storage for Firebase
-   Cloud Firestore
-   Firebase Android SDK

### No unnecessary external API

The backup engine does not need:

-   weather API
-   geocoding API
-   random file API
-   public file-hosting API
-   URL shortener
-   third-party storage API

Do not add an external API merely because a public API catalog contains
one.

## Research rule

For every API/dependency, document:

``` text
Name
Purpose
Official documentation
Version
Minimum supported Android version
Authentication requirements
Rate limits
Failure behavior
Offline behavior
License
Security implications
Why it is needed
Alternative considered
```

## Source priority

1.  Official Android documentation.
2.  Official Firebase documentation.
3.  Official SDK/API reference.
4.  Official GitHub repository of the dependency.
5.  Reputable technical references.
6.  Community posts only as troubleshooting evidence.

Do not treat a random GitHub snippet as an API contract.
