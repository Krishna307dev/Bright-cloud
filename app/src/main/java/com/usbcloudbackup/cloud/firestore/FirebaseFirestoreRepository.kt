package com.usbcloudbackup.cloud.firestore

import android.util.Log
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.SetOptions
import com.usbcloudbackup.backup.ReservedNameResult
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.util.ReservationUtils
import java.util.Date
import kotlinx.coroutines.tasks.await

class FirebaseFirestoreRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance()
) : FirestoreRepository {

    companion object {
        private const val TAG = "FirebaseFirestoreRepo"
        const val RESERVATION_TTL_MS = 24 * 60 * 60 * 1000L
    }

    override suspend fun saveSource(vaultId: String, source: UsbSource) {
        val sourceRef = firestore.collection("vaults").document(vaultId)
            .collection("sources").document(source.sourceId)

        val updateMap = mutableMapOf<String, Any>(
            "lastSeen" to Timestamp(Date(source.lastSeen)),
            "displayName" to source.displayName
        )
        if (!source.volumeUuid.isNullOrBlank()) {
            updateMap["volumeUuid"] = source.volumeUuid
        }

        try {
            sourceRef.update(updateMap).await()
            Log.i(TAG, "Source updated in Firestore vault $vaultId. sourceId=${source.sourceId}")
        } catch (e: FirebaseFirestoreException) {
            if (e.code == FirebaseFirestoreException.Code.NOT_FOUND) {
                val sourceData = mapOf(
                    "sourceId" to source.sourceId,
                    "usbVendorId" to source.usbVendorId,
                    "usbProductId" to source.usbProductId,
                    "serialNumber" to source.serialNumber,
                    "volumeUuid" to source.volumeUuid,
                    "displayName" to source.displayName,
                    "firstSeen" to Timestamp(Date(source.firstSeen)),
                    "lastSeen" to Timestamp(Date(source.lastSeen)),
                    "totalFilesBackedUp" to 0
                )
                sourceRef.set(sourceData).await()
                Log.i(TAG, "Source created in Firestore vault $vaultId. sourceId=${source.sourceId}")
            } else {
                Log.e(TAG, "Failed to save source to Firestore: ${e.code}", e)
                throw e
            }
        }
    }

    override suspend fun isContentHashIndexed(vaultId: String, sha256: String): Boolean {
        val hashDoc = firestore.collection("vaults").document(vaultId)
            .collection("contentHashes").document(sha256)
            .get()
            .await()

        return hashDoc.exists()
    }

    override suspend fun reserveCloudFilename(
        vaultId: String,
        sourceId: String,
        relativePath: String,
        originalName: String,
        sha256: String,
        jobId: String,
        ownerTaskId: String
    ): ReservedNameResult {
        return firestore.runTransaction { tx ->
            var version = 0
            val maxAttempts = 1000

            while (version < maxAttempts) {
                val candidateName = ReservationUtils.formatStoredName(originalName, version)
                val b2ObjectKey = ReservationUtils.buildB2ObjectKey(vaultId, sourceId, relativePath, candidateName)
                val reservationId = ReservationUtils.encodeReservationId(sourceId, relativePath, candidateName)

                val resRef = firestore.collection("vaults").document(vaultId)
                    .collection("nameReservations").document(reservationId)
                val snapshot = tx.get(resRef)

                if (snapshot.exists()) {
                    val status = snapshot.getString("status")
                    val expiresAt = snapshot.getTimestamp("expiresAt")?.toDate()?.time ?: 0L
                    val resJobId = snapshot.getString("jobId")
                    val resSha256 = snapshot.getString("sha256")

                    if (status == "COMMITTED") {
                        version++
                        continue
                    }

                    if (status == "PENDING") {
                        val isExpired = System.currentTimeMillis() > expiresAt
                        val isSameJob = (resJobId == jobId && resSha256 == sha256)

                        var canReclaim = false
                        if (!isExpired && !isSameJob && resSha256 == sha256) {
                            if (!resJobId.isNullOrBlank()) {
                                val oldJobRef = firestore.collection("vaults").document(vaultId)
                                    .collection("backupJobs").document(resJobId)
                                val oldJobSnap = tx.get(oldJobRef)
                                val oldJobState = oldJobSnap.getString("state")
                                val isOldJobTerminal = !oldJobSnap.exists() || oldJobState in listOf("COMPLETED", "FAILED", "CANCELLED")
                                if (isOldJobTerminal) {
                                    canReclaim = true
                                }
                            } else {
                                canReclaim = true
                            }
                        }

                        if (!isExpired && !isSameJob && !canReclaim) {
                            version++
                            continue
                        }
                    }
                }

                val now = System.currentTimeMillis()
                val expiresAtTime = now + RESERVATION_TTL_MS
                val reservationData = mapOf(
                    "reservationId" to reservationId,
                    "sha256" to sha256,
                    "b2ObjectKey" to b2ObjectKey,
                    "storageBackend" to "B2",
                    "vaultId" to vaultId,
                    "sourceId" to sourceId,
                    "relativePath" to relativePath,
                    "originalName" to originalName,
                    "storedName" to candidateName,
                    "status" to "PENDING",
                    "jobId" to jobId,
                    "ownerTaskId" to ownerTaskId,
                    "createdAt" to Timestamp(Date(now)),
                    "expiresAt" to Timestamp(Date(expiresAtTime))
                )

                tx.set(resRef, reservationData)

                return@runTransaction ReservedNameResult(
                    storedName = candidateName,
                    version = version,
                    reservationId = reservationId,
                    b2ObjectKey = b2ObjectKey,
                    isReused = false
                )
            }

            throw IllegalStateException("Exceeded max filename collision attempts for $originalName")
        }.await()
    }

    override suspend fun finalizeUploadTransaction(
        vaultId: String,
        file: BackupFile,
        storedName: String,
        b2ObjectKey: String,
        reservationId: String,
        jobId: String,
        storageRepository: com.usbcloudbackup.cloud.storage.CloudStorageRepository?,
        pendingDeletionStore: com.usbcloudbackup.cloud.storage.b2.IPendingDeletionStore?
    ): String {
        val (finalFileId, redundantKeyToDelete) = firestore.runTransaction { tx ->
            val generatedFileId = firestore.collection("vaults").document(vaultId)
                .collection("files").document().id
            val fileRef = firestore.collection("vaults").document(vaultId)
                .collection("files").document(generatedFileId)

            val sha256 = file.sha256
            val hashRef = if (!sha256.isNullOrBlank()) {
                firestore.collection("vaults").document(vaultId)
                    .collection("contentHashes").document(sha256)
            } else null

            // 1. ALL READS FIRST (Strict Firestore Invariant: reads before writes)
            val hashSnapshot = hashRef?.let { tx.get(it) }

            val hashExists = hashSnapshot != null && hashSnapshot.exists()
            val canonicalFileId = if (hashExists) hashSnapshot?.getString("fileId") else null
            val canonicalB2Key = if (hashExists) (hashSnapshot?.getString("b2ObjectKey") ?: b2ObjectKey) else b2ObjectKey
            val hashSourceId = if (hashExists) hashSnapshot?.getString("sourceId") else null
            val hashRelativePath = if (hashExists) hashSnapshot?.getString("relativePath") else null
            val hashOriginalName = if (hashExists) hashSnapshot?.getString("originalName") else null

            val redundantKey = if (hashExists && canonicalB2Key != b2ObjectKey) b2ObjectKey else null

            // Check if this is the exact same logical file already indexed in the vault.
            // If sourceId is missing from legacy hash doc, isSameLogicalFile = false (fallback: link new file doc, reuse canonicalB2Key).
            val isSameLogicalFile = hashExists &&
                    !hashSourceId.isNullOrBlank() &&
                    hashSourceId == file.sourceId &&
                    hashRelativePath == file.relativePath &&
                    hashOriginalName == file.originalName

            if (isSameLogicalFile && !canonicalFileId.isNullOrBlank()) {
                // Another phone or concurrent worker already finalized the identical file.
                // Do NOT create duplicate file metadata.
                if (reservationId.isNotBlank()) {
                    val resRef = firestore.collection("vaults").document(vaultId)
                        .collection("nameReservations").document(reservationId)
                    tx.update(resRef, "status", "EXPIRED")
                }

                val jobRef = firestore.collection("vaults").document(vaultId)
                    .collection("backupJobs").document(jobId)
                tx.update(jobRef, "skippedFiles", FieldValue.increment(1))

                return@runTransaction Pair(canonicalFileId, redundantKey)
            }

            // 2. ALL WRITES SECOND
            val effectiveB2Key = if (hashExists) canonicalB2Key else b2ObjectKey
            val fileData = mapOf(
                "fileId" to generatedFileId,
                "sourceId" to file.sourceId,
                "relativePath" to file.relativePath,
                "originalName" to file.originalName,
                "storedName" to storedName,
                "b2ObjectKey" to effectiveB2Key,
                "storageBackend" to "B2",
                "sha256" to (file.sha256 ?: ""),
                "size" to file.size,
                "lastModified" to file.lastModified,
                "mimeType" to (file.mimeType ?: ""),
                "backupMode" to file.backupMode,
                "status" to "UPLOADED",
                "isPublicToFriends" to true,
                "allowedFriends" to emptyList<String>(),
                "uploadedAt" to FieldValue.serverTimestamp(),
                "jobId" to jobId
            )
            tx.set(fileRef, fileData)

            if (hashRef != null && hashSnapshot != null && !hashSnapshot.exists()) {
                val hashData = mapOf(
                    "sha256" to sha256,
                    "fileId" to generatedFileId,
                    "b2ObjectKey" to b2ObjectKey,
                    "storageBackend" to "B2",
                    "size" to file.size,
                    "storedName" to storedName,
                    "sourceId" to file.sourceId,
                    "relativePath" to file.relativePath,
                    "originalName" to file.originalName,
                    "uploadedAt" to FieldValue.serverTimestamp()
                )
                tx.set(hashRef, hashData)
            }

            if (reservationId.isNotBlank()) {
                val resRef = firestore.collection("vaults").document(vaultId)
                    .collection("nameReservations").document(reservationId)
                tx.update(resRef, "status", "COMMITTED")
            }

            val jobRef = firestore.collection("vaults").document(vaultId)
                .collection("backupJobs").document(jobId)
            tx.update(jobRef, "uploadedFiles", FieldValue.increment(1))

            return@runTransaction Pair(generatedFileId, redundantKey)
        }.await()

        if (redundantKeyToDelete != null) {
            pendingDeletionStore?.recordPendingDeletion(redundantKeyToDelete)
            if (storageRepository != null) {
                try {
                    Log.i(TAG, "Cleaning up redundant B2 object after concurrent upload race: $redundantKeyToDelete")
                    val deleted = storageRepository.deleteObject(redundantKeyToDelete)
                    if (deleted) {
                        pendingDeletionStore?.removePendingDeletion(redundantKeyToDelete)
                    } else {
                        Log.w(TAG, "Redundant B2 delete returned false for $redundantKeyToDelete; preserved in PendingDeletionStore for retry.")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Non-fatal error cleaning up redundant B2 object $redundantKeyToDelete: ${e.message}; preserved in PendingDeletionStore.")
                }
            }
        }

        return finalFileId
    }

    override suspend fun indexMetadataOnlyFile(
        vaultId: String,
        file: BackupFile,
        jobId: String
    ): String {
        val fileRef = firestore.collection("vaults").document(vaultId)
            .collection("files").document()
        val generatedFileId = fileRef.id

        val fileData = mapOf(
            "fileId" to generatedFileId,
            "sourceId" to file.sourceId,
            "relativePath" to file.relativePath,
            "originalName" to file.originalName,
            "storedName" to file.originalName,
            "extension" to file.extension,
            "size" to file.size,
            "lastModified" to file.lastModified,
            "mimeType" to (file.mimeType ?: ""),
            "backupMode" to "METADATA_ONLY",
            "status" to "METADATA_INDEXED",
            "storageBackend" to "B2",
            "isPublicToFriends" to true,
            "allowedFriends" to emptyList<String>(),
            "jobId" to jobId
        )

        fileRef.set(fileData).await()
        Log.i(TAG, "Indexed Category B metadata-only file: ${file.originalName} ($generatedFileId)")
        return generatedFileId
    }

    override suspend fun updateBackupJobState(vaultId: String, job: BackupJob) {
        val jobRef = firestore.collection("vaults").document(vaultId)
            .collection("backupJobs").document(job.jobId)

        val jobData = mapOf(
            "jobId" to job.jobId,
            "sourceId" to job.sourceId,
            "state" to job.state.name,
            "startedAt" to Timestamp(Date(job.startedAt)),
            "completedAt" to job.completedAt?.let { Timestamp(Date(it)) },
            "totalFiles" to job.totalFiles,
            "skippedFiles" to job.skippedFiles,
            "uploadedFiles" to job.uploadedFiles,
            "errorFiles" to job.errorFiles
        )

        jobRef.set(jobData, SetOptions.merge()).await()
        Log.i(TAG, "Backup job state updated in Firestore vault $vaultId. jobId=${job.jobId}, state=${job.state.name}")
    }
}
