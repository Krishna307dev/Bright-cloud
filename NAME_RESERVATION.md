---

# Name Reservation

## Problem

When a new file needs a versioned filename (e.g., `CHAPTER_5(1).pdf`), the version number must be reserved atomically to prevent two concurrent workers from claiming the same name.

Additionally, if a reservation is created but the upload fails, the reserved name must not be permanently blocked.

## Reservation Schema

### Firestore document: `vaults/{vaultId}/nameReservations/{reservationId}`

| Field | Type | Description |
|---|---|---|
| reservationId | string | Document ID (see below) |
| sha256 | string | Content hash of the file being uploaded |
| b2ObjectKey | string | Full Backblaze B2 object key |
| vaultId | string | Target shared vault ID |
| sourceId | string | USB device fingerprint |
| relativePath | string | Directory path from USB root |
| originalName | string | Original USB filename |
| storedName | string | Reserved cloud filename |
| version | number | Version number (0 = original, 1 = (1), etc.) |
| status | string | PENDING / COMMITTED / EXPIRED |
| jobId | string | Backup job ID |
| ownerTaskId | string | Local UploadTaskEntity ID |
| createdAt | timestamp | Server timestamp |
| expiresAt | timestamp | createdAt + 24 hours |

### Document ID format

```text
{sourceId}_{relativePath}_{storedName}
```

URL-safe encoding: replace `/` with `_SLASH_`, spaces with `_SPACE_`.

Example: `0781-5583-8F12-3456_Notes_SLASH_Math_SLASH__CHAPTER_5(1).pdf`

Using the stored name (not original name) as part of the ID ensures each version has a unique reservation document.

## Owner and Job ID

Each reservation is owned by a specific `jobId` and `ownerTaskId`. This enables:
- Determining whether a reservation belongs to the current job.
- Allowing the same job to re-use its own unexpired reservation after a crash.

## TTL / Expiry

Reservations have a **24-hour TTL** (`expiresAt = createdAt + 24 hours`).

A reservation with status `PENDING` whose `expiresAt` has passed is considered **expired** and can be overwritten by a new reservation.

A reservation with status `COMMITTED` never expires — it represents a successfully uploaded file.

## Transaction Behavior

### Reserving a filename

```text
1. Determine desired storedName (original name or versioned)
2. Compute reservationId from sourceId + relativePath + storedName
3. Run Firestore transaction:
   a. Read the reservation document
   b. If document does not exist → create with status=PENDING
   c. If document exists with status=COMMITTED → name is permanently taken
   d. If document exists with status=PENDING and not expired → name is temporarily taken
   e. If document exists with status=PENDING and expired → overwrite with new reservation
   f. If document exists with status=EXPIRED → overwrite with new reservation
4. If name is taken → increment version number, try again with next name
```

### Algorithm: Find next available version

```kotlin
fun reserveFilename(
    uid: String,
    sourceId: String,
    relativePath: String,
    originalName: String,
    sha256: String,
    jobId: String,
    taskId: String
): ReservationResult {
    val (basename, extension) = splitFilename(originalName)
    var version = 0
    var storedName = originalName

    while (true) {
        val resId = encodeReservationId(sourceId, relativePath, storedName)
        try {
            firestore.runTransaction { tx ->
                val docRef = db.collection("users/$uid/nameReservations").document(resId)
                val snapshot = tx.get(docRef)

                if (snapshot.exists()) {
                    val status = snapshot.getString("status")
                    val expiresAt = snapshot.getTimestamp("expiresAt")
                    val existingJobId = snapshot.getString("jobId")

                    when {
                        status == "COMMITTED" -> throw NameTakenException()
                        status == "PENDING" && existingJobId == jobId -> {
                            // Our own reservation from a previous attempt — reuse
                            return@runTransaction
                        }
                        status == "PENDING" && !isExpired(expiresAt) -> throw NameTakenException()
                        else -> {
                            // Expired or EXPIRED status — overwrite
                            tx.set(docRef, buildReservation(...))
                        }
                    }
                } else {
                    tx.set(docRef, buildReservation(...))
                }
            }.await()
            return ReservationResult(storedName, version, resId)
        } catch (e: NameTakenException) {
            version++
            storedName = "$basename($version)$extension"
        }
    }
}
```

## Retry Behavior

- Firestore transactions automatically retry on contention (up to 25 times).
- If transaction fails due to network → WorkManager retries the entire worker.
- If `NameTakenException` → increment version and try next name (not a retry, just the next candidate).

## Crash Recovery

### Crash after reservation, before upload

1. Room UploadTaskEntity has `reservationId` saved.
2. On worker restart, check Firestore for the reservation.
3. If reservation exists with our `jobId` and status=PENDING and not expired → reuse it.
4. If reservation expired → re-reserve (may get a different version number).

### Crash after upload, before commit

1. Room state = UPLOADED_NOT_INDEXED.
2. File exists in Cloud Storage.
3. Reservation exists in Firestore with status=PENDING.
4. Finalization transaction updates reservation to COMMITTED.

### Upload fails permanently

1. Reservation stays as PENDING.
2. After 24 hours, reservation expires.
3. Reconciliation worker cleans up expired reservations.
4. The version number becomes available again.

## Cleanup

### Reconciliation worker

Runs on boot, on USB attach, and periodically (every 6 hours).

```text
Query: users/{uid}/nameReservations where status=PENDING and expiresAt < now
For each expired reservation:
  1. Check if corresponding Cloud Storage object exists
  2. If object exists → the upload succeeded but finalization failed
     → Attempt finalization (create file doc, hash index, commit reservation)
  3. If object does not exist → the upload never completed
     → Delete the reservation document (free the name)
```

## Concurrent Workers

- Two workers attempting to reserve the same name will be serialized by the Firestore transaction.
- The first writer wins. The second sees the existing reservation and tries the next version.
- `ExistingWorkPolicy.KEEP` prevents duplicate backup chains for the same USB device.
- Different USB devices use different WorkManager work names and do not collide on filenames (different sourceId in the reservation ID).

## Duplicate USB Events

- If the same USB device generates multiple ATTACHED events, `ExistingWorkPolicy.KEEP` ensures only one backup chain runs.
- The running chain's reservations are valid.
- A duplicate event cannot create duplicate reservations.

---
