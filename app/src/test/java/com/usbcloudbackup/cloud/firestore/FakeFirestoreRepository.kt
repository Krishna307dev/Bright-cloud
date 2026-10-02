package com.usbcloudbackup.cloud.firestore

import com.usbcloudbackup.backup.ReservedNameResult
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.util.ReservationUtils
import java.util.UUID

class FakeFirestoreRepository : FirestoreRepository {

    val sources = mutableMapOf<String, UsbSource>()
    val files = mutableMapOf<String, Map<String, Any>>()
    val contentHashes = mutableMapOf<String, Map<String, Any>>()
    val nameReservations = mutableMapOf<String, Map<String, Any>>()
    val backupJobs = mutableMapOf<String, BackupJob>()

    var finalizeTransactionCount = 0
        private set

    var metadataOnlyIndexCount = 0
        private set

    var shouldFailMetadataIndexing: Boolean = false

    fun clear() {
        sources.clear()
        files.clear()
        contentHashes.clear()
        nameReservations.clear()
        backupJobs.clear()
        finalizeTransactionCount = 0
        metadataOnlyIndexCount = 0
        shouldFailMetadataIndexing = false
        failFinalizeTransactionTimes = 0
    }

    var failFinalizeTransactionTimes = 0

    fun indexContentHash(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        sha256: String,
        fileId: String = UUID.randomUUID().toString(),
        b2ObjectKey: String = "backups/$vaultId/source/file.txt",
        size: Long = 100L,
        storedName: String = "file.txt"
    ) {
        val hashKey = "${vaultId}_$sha256"
        contentHashes[hashKey] = mapOf(
            "sha256" to sha256,
            "fileId" to fileId,
            "b2ObjectKey" to b2ObjectKey,
            "storageBackend" to "B2",
            "size" to size,
            "storedName" to storedName
        )
    }

    override suspend fun saveSource(vaultId: String, source: UsbSource) {
        sources["${vaultId}_${source.sourceId}"] = source
    }

    override suspend fun isContentHashIndexed(vaultId: String, sha256: String): Boolean {
        return contentHashes.containsKey("${vaultId}_$sha256")
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
        var version = 0
        while (version < 100) {
            val candidateName = ReservationUtils.formatStoredName(originalName, version)
            val resId = ReservationUtils.encodeReservationId(sourceId, relativePath, candidateName)
            val resKey = "${vaultId}_$resId"

            if (nameReservations.containsKey(resKey)) {
                val existing = nameReservations[resKey]!!
                val status = existing["status"] as? String
                val exp = existing["expiresAt"] as? Long ?: 0L
                val resJobId = existing["jobId"] as? String
                val resSha256 = existing["sha256"] as? String

                if (status == "COMMITTED") {
                    version++
                    continue
                }

                if (status == "PENDING") {
                    val isExpired = System.currentTimeMillis() > exp
                    val isSameJob = (resJobId == jobId && resSha256 == sha256)

                    var canReclaim = false
                    if (!isExpired && !isSameJob && resSha256 == sha256) {
                        if (!resJobId.isNullOrBlank()) {
                            val oldJob = backupJobs["${vaultId}_$resJobId"]
                            val isOldJobTerminal = oldJob == null || oldJob.state in listOf(
                                com.usbcloudbackup.backup.model.BackupJobState.COMPLETED,
                                com.usbcloudbackup.backup.model.BackupJobState.FAILED,
                                com.usbcloudbackup.backup.model.BackupJobState.CANCELLED
                            )
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

            val b2Key = ReservationUtils.buildB2ObjectKey(vaultId, sourceId, relativePath, candidateName)
            nameReservations[resKey] = mapOf(
                "reservationId" to resId,
                "sha256" to sha256,
                "b2ObjectKey" to b2Key,
                "storageBackend" to "B2",
                "vaultId" to vaultId,
                "sourceId" to sourceId,
                "relativePath" to relativePath,
                "originalName" to originalName,
                "storedName" to candidateName,
                "status" to "PENDING",
                "jobId" to jobId,
                "ownerTaskId" to ownerTaskId,
                "createdAt" to System.currentTimeMillis(),
                "expiresAt" to System.currentTimeMillis() + 86400000L
            )

            return ReservedNameResult(
                storedName = candidateName,
                version = version,
                reservationId = resId,
                b2ObjectKey = b2Key,
                isReused = false
            )
        }
        throw IllegalStateException("Too many collision retries in fake")
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
    ): String = synchronized(this) {
        if (failFinalizeTransactionTimes > 0) {
            failFinalizeTransactionTimes--
            throw com.google.firebase.firestore.FirebaseFirestoreException(
                "Firestore transactions require all reads to be executed before all writes.",
                com.google.firebase.firestore.FirebaseFirestoreException.Code.INVALID_ARGUMENT
            )
        }
        finalizeTransactionCount++

        val sha256 = file.sha256
        val hashKey = if (!sha256.isNullOrBlank()) "${vaultId}_$sha256" else null
        val existingHash = hashKey?.let { contentHashes[it] }

        val canonicalFileId = existingHash?.get("fileId") as? String
        val canonicalB2Key = existingHash?.get("b2ObjectKey") as? String ?: b2ObjectKey
        val hashSourceId = existingHash?.get("sourceId") as? String
        val hashRelativePath = existingHash?.get("relativePath") as? String
        val hashOriginalName = existingHash?.get("originalName") as? String

        val redundantKeyToDelete = if (existingHash != null && canonicalB2Key != b2ObjectKey) b2ObjectKey else null

        fun cleanupRedundantKey() {
            if (redundantKeyToDelete != null) {
                pendingDeletionStore?.recordPendingDeletion(redundantKeyToDelete)
                if (storageRepository != null) {
                    try {
                        val deleted = kotlinx.coroutines.runBlocking {
                            storageRepository.deleteObject(redundantKeyToDelete)
                        }
                        if (deleted) {
                            pendingDeletionStore?.removePendingDeletion(redundantKeyToDelete)
                        }
                    } catch (e: Exception) {
                        // Preserved in pendingDeletionStore
                    }
                }
            }
        }

        val isSameLogicalFile = existingHash != null &&
                !hashSourceId.isNullOrBlank() &&
                hashSourceId == file.sourceId &&
                hashRelativePath == file.relativePath &&
                hashOriginalName == file.originalName

        if (isSameLogicalFile && !canonicalFileId.isNullOrBlank()) {
            if (reservationId.isNotBlank()) {
                val resKey = "${vaultId}_$reservationId"
                if (nameReservations.containsKey(resKey)) {
                    val updated = nameReservations[resKey]!!.toMutableMap()
                    updated["status"] = "EXPIRED"
                    nameReservations[resKey] = updated
                }
            }
            val jobKey = "${vaultId}_$jobId"
            backupJobs[jobKey]?.let { job ->
                backupJobs[jobKey] = job.copy(skippedFiles = job.skippedFiles + 1)
            }
            cleanupRedundantKey()
            return canonicalFileId
        }

        val generatedFileId = UUID.randomUUID().toString()
        val fileKey = "${vaultId}_$generatedFileId"
        val effectiveB2Key = if (existingHash != null) canonicalB2Key else b2ObjectKey

        files[fileKey] = mapOf(
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
            "jobId" to jobId
        )

        file.sha256?.let { hash ->
            val hKey = "${vaultId}_$hash"
            if (!contentHashes.containsKey(hKey)) {
                contentHashes[hKey] = mapOf(
                    "sha256" to hash,
                    "fileId" to generatedFileId,
                    "b2ObjectKey" to b2ObjectKey,
                    "storageBackend" to "B2",
                    "size" to file.size,
                    "storedName" to storedName,
                    "sourceId" to file.sourceId,
                    "relativePath" to file.relativePath,
                    "originalName" to file.originalName
                )
            }
        }

        if (reservationId.isNotBlank()) {
            val resKey = "${vaultId}_$reservationId"
            if (nameReservations.containsKey(resKey)) {
                val updated = nameReservations[resKey]!!.toMutableMap()
                updated["status"] = "COMMITTED"
                nameReservations[resKey] = updated
            }
        }

        val jobKey = "${vaultId}_$jobId"
        backupJobs[jobKey]?.let { job ->
            backupJobs[jobKey] = job.copy(uploadedFiles = job.uploadedFiles + 1)
        }

        cleanupRedundantKey()

        return generatedFileId
    }

    override suspend fun indexMetadataOnlyFile(
        vaultId: String,
        file: BackupFile,
        jobId: String
    ): String {
        if (shouldFailMetadataIndexing) {
            throw RuntimeException("PERMISSION_DENIED: Simulation")
        }
        metadataOnlyIndexCount++
        val generatedFileId = UUID.randomUUID().toString()
        val fileKey = "${vaultId}_$generatedFileId"

        files[fileKey] = mapOf(
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

        return generatedFileId
    }

    override suspend fun updateBackupJobState(vaultId: String, job: BackupJob) {
        backupJobs["${vaultId}_${job.jobId}"] = job
    }
}
