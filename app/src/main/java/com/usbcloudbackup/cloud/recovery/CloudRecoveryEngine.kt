package com.usbcloudbackup.cloud.recovery

import android.util.Log
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.backup.model.UploadTask
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.cloud.firestore.FirestoreRepository
import com.usbcloudbackup.cloud.storage.CloudStorageRepository
import com.usbcloudbackup.config.VaultConfig
import java.io.InputStream

class CloudRecoveryEngine(
    private val fileRepository: FileRepository,
    private val jobRepository: BackupJobRepository,
    private val uploadRepository: UploadRepository,
    private val firestoreRepository: FirestoreRepository,
    private val cloudStorageRepository: CloudStorageRepository,
    private val reservationRepository: ReservationRepository? = null,
    private val pendingDeletionStore: com.usbcloudbackup.cloud.storage.b2.IPendingDeletionStore? = null
) {

    companion object {
        private const val TAG = "CloudRecoveryEngine"
    }

    suspend fun checkCloudDeduplication(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        file: BackupFile
    ): Boolean {
        val hash = file.sha256
        checkNotNull(hash) { "File must be hashed before cloud deduplication check. fileId=${file.id}" }

        val isIndexedInCloud = firestoreRepository.isContentHashIndexed(vaultId, hash)
        if (isIndexedInCloud) {
            Log.i(TAG, "Content hash exists in vault $vaultId cloud index! Skipping upload for fileId=${file.id}, originalName=${file.originalName}")
            fileRepository.updateFileStatus(file.id, FileStatus.SKIPPED_DUPLICATE)
            jobRepository.incrementSkipped(file.jobId)
            return true
        }

        return false
    }

    suspend fun processOrRecoverUpload(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        file: BackupFile,
        task: UploadTask,
        inputStreamProvider: () -> InputStream,
        onProgress: ((bytesUploaded: Long, totalBytes: Long) -> Unit)? = null
    ): Boolean {
        val b2ObjectKey = task.b2ObjectKey
        val sha256 = file.sha256!!

        Log.i(TAG, "Processing upload or recovery. fileId=${file.id}, taskId=${task.taskId}, state=${task.state}, b2Key=$b2ObjectKey")

        // Step 1: Check if object already exists in Backblaze B2
        val existingMetadata = cloudStorageRepository.checkObjectExists(b2ObjectKey)

        val isObjectUploaded = existingMetadata != null && existingMetadata.sha256 == sha256

        if (!isObjectUploaded) {
            // Upload bytes to Backblaze B2 S3 storage
            uploadRepository.updateTaskState(task.taskId, UploadTaskState.UPLOADING)
            fileRepository.updateFileStatus(file.id, FileStatus.UPLOADING)

            val customMetadata = mapOf(
                "Content-Length" to file.size.toString(),
                "x-custom-file-size" to file.size.toString(),
                "x-amz-meta-sha256" to sha256,
                "x-amz-meta-source-id" to file.sourceId,
                "x-amz-meta-original-name" to file.originalName,
                "x-amz-meta-file-id" to file.id.toString(),
                "x-custom-sha256" to sha256,
                "x-custom-source-id" to file.sourceId,
                "x-custom-original-name" to file.originalName,
                "x-custom-file-id" to file.id.toString()
            )

            val uploadResult = cloudStorageRepository.uploadFileStream(
                cloudObjectPath = b2ObjectKey,
                inputStream = inputStreamProvider(),
                metadata = customMetadata,
                sessionUri = task.uploadSessionUri,
                onProgress = onProgress
            )

            // Save upload session URI to Room
            if (uploadResult.sessionUri != null) {
                uploadRepository.updateSessionUri(task.taskId, uploadResult.sessionUri)
            }

            // Transition state to UPLOADED_NOT_INDEXED
            uploadRepository.updateTaskState(task.taskId, UploadTaskState.UPLOADED_NOT_INDEXED)
            fileRepository.updateFileStatus(file.id, FileStatus.UPLOADED_NOT_INDEXED)
            Log.i(TAG, "Backblaze B2 upload succeeded. Transitioned to UPLOADED_NOT_INDEXED. fileId=${file.id}")
        } else {
            Log.i(TAG, "Backblaze B2 object already verified. Bypassing byte upload. fileId=${file.id}")
            uploadRepository.updateTaskState(task.taskId, UploadTaskState.UPLOADED_NOT_INDEXED)
            fileRepository.updateFileStatus(file.id, FileStatus.UPLOADED_NOT_INDEXED)
        }

        // Step 2: Firestore Finalization Transaction
        val storedName = file.cloudFilename ?: file.originalName
        val reservationId = task.reservationId

        val firestoreFileId = firestoreRepository.finalizeUploadTransaction(
            vaultId = vaultId,
            file = file,
            storedName = storedName,
            b2ObjectKey = b2ObjectKey,
            reservationId = reservationId,
            jobId = file.jobId,
            storageRepository = cloudStorageRepository,
            pendingDeletionStore = pendingDeletionStore
        )

        // Step 3: Transition state to INDEXED & commit local reservation
        fileRepository.updateFileStatus(file.id, FileStatus.INDEXED)
        uploadRepository.updateTaskState(task.taskId, UploadTaskState.INDEXED)
        jobRepository.incrementUploaded(file.jobId)
        if (reservationId.isNotBlank()) {
            reservationRepository?.updateReservationStatus(reservationId, ReservationStatus.COMMITTED)
        }

        Log.i(TAG, "File backup fully indexed and finalized in vault $vaultId. fileId=${file.id}, firestoreFileId=$firestoreFileId")
        return true
    }
}
