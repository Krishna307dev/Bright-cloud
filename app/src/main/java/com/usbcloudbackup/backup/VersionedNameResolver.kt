package com.usbcloudbackup.backup

import android.util.Log
import androidx.room.withTransaction
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.NameReservation
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.backup.model.UploadTask
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.util.ReservationUtils

class VersionedNameResolver(
    private val db: AppDatabase,
    private val fileRepository: FileRepository,
    private val reservationRepository: ReservationRepository,
    private val uploadRepository: UploadRepository,
    private val jobRepository: BackupJobRepository? = null
) {
    companion object {
        private const val TAG = "VersionedNameResolver"
        const val RESERVATION_TTL_MS = 24 * 60 * 60 * 1000L // 24 Hours in milliseconds
    }

    suspend fun reserveFilename(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        file: BackupFile,
        ownerTaskId: String,
        currentTime: Long = System.currentTimeMillis(),
        preferredVersion: Int? = null
    ): ReservedNameResult {
        val hash = file.sha256
        checkNotNull(hash) { "Cannot reserve filename for unhashed file. fileId=${file.id}" }

        Log.i(TAG, "Starting filename reservation. fileId=${file.id}, originalName=${file.originalName}, relativePath=${file.relativePath}")

        // Step 1: Check if this file already has an existing valid unexpired reservation from a previous attempt
        val existingTask = uploadRepository.getTaskForFile(file.id)
        if (existingTask != null) {
            val existingRes = reservationRepository.getReservation(existingTask.reservationId)
            if (existingRes != null && existingRes.status == ReservationStatus.PENDING && existingRes.expiresAt > currentTime) {
                if (preferredVersion == null || existingRes.version == preferredVersion) {
                    Log.i(TAG, "Reusing existing valid reservation. resId=${existingRes.reservationId}, storedName=${existingRes.storedName}")
                    return ReservedNameResult(
                        storedName = existingRes.storedName,
                        version = existingRes.version,
                        reservationId = existingRes.reservationId,
                        b2ObjectKey = existingRes.b2ObjectKey,
                        isReused = true
                    )
                }
            }
        }

        // Step 2: Candidate iteration and atomic reservation
        var version = preferredVersion ?: 0
        var storedName: String
        var reservationResult: ReservedNameResult? = null

        while (reservationResult == null) {
            storedName = ReservationUtils.formatStoredName(file.originalName, version)
            val resId = ReservationUtils.encodeReservationId(file.sourceId, file.relativePath, storedName)
            val b2Key = ReservationUtils.buildB2ObjectKey(vaultId, file.sourceId, file.relativePath, storedName)

            val success = tryReserveCandidate(
                vaultId = vaultId,
                file = file,
                storedName = storedName,
                version = version,
                resId = resId,
                b2Key = b2Key,
                ownerTaskId = ownerTaskId,
                currentTime = currentTime
            )

            if (success) {
                reservationResult = ReservedNameResult(
                    storedName = storedName,
                    version = version,
                    reservationId = resId,
                    b2ObjectKey = b2Key,
                    isReused = false
                )
            } else {
                version++
            }
        }

        Log.i(TAG, "Filename reserved successfully. fileId=${file.id}, storedName=${reservationResult.storedName}, version=${reservationResult.version}")
        return reservationResult
    }

    private suspend fun tryReserveCandidate(
        vaultId: String,
        file: BackupFile,
        storedName: String,
        version: Int,
        resId: String,
        b2Key: String,
        ownerTaskId: String,
        currentTime: Long
    ): Boolean {
        return db.withTransaction {
            val existingRes = reservationRepository.getReservation(resId)
            val existingFile = fileRepository.findExistingFileByStoredName(file.sourceId, file.relativePath, storedName, excludeFileId = file.id)

            val nameIsTakenByCommitted = (existingRes != null && existingRes.status == ReservationStatus.COMMITTED) ||
                    (existingFile != null && existingFile.id != file.id && existingFile.status in listOf(
                        FileStatus.INDEXED,
                        FileStatus.UPLOADED_NOT_INDEXED,
                        FileStatus.UPLOADING
                    ))

            val oldJob = existingRes?.jobId?.let { jobRepository?.getJob(it) }
            val isOldJobTerminal = oldJob == null || oldJob.state in listOf(
                BackupJobState.COMPLETED,
                BackupJobState.FAILED,
                BackupJobState.CANCELLED
            )
            val canReclaimPending = existingRes != null &&
                    existingRes.status == ReservationStatus.PENDING &&
                    existingRes.sha256 == file.sha256 &&
                    isOldJobTerminal

            val nameIsTakenByPending = existingRes != null &&
                    existingRes.status == ReservationStatus.PENDING &&
                    existingRes.expiresAt > currentTime &&
                    !canReclaimPending &&
                    (existingRes.jobId != file.jobId || existingRes.sha256 != file.sha256)

            if (nameIsTakenByCommitted || nameIsTakenByPending) {
                return@withTransaction false
            }

            // Name is available or existing reservation is expired/ours/reclaimed
            val expiresAt = currentTime + RESERVATION_TTL_MS
            val newReservation = NameReservation(
                reservationId = resId,
                sha256 = file.sha256!!,
                b2ObjectKey = b2Key,
                sourceId = file.sourceId,
                relativePath = file.relativePath,
                originalName = file.originalName,
                storedName = storedName,
                version = version,
                status = ReservationStatus.PENDING,
                jobId = file.jobId,
                ownerTaskId = ownerTaskId,
                createdAt = currentTime,
                expiresAt = expiresAt
            )

            reservationRepository.saveReservation(newReservation)

            fileRepository.updateFileCloudInfo(
                fileId = file.id,
                cloudFilename = storedName,
                b2ObjectKey = b2Key,
                newStatus = FileStatus.NAME_RESERVED
            )

            val task = UploadTask(
                taskId = ownerTaskId,
                fileId = file.id,
                state = UploadTaskState.RESERVED,
                b2ObjectKey = b2Key,
                uploadSessionUri = null,
                reservationId = resId,
                sha256 = file.sha256,
                bytesTransferred = 0L,
                totalBytes = file.size,
                updatedAt = currentTime
            )

            uploadRepository.deleteTaskForFile(file.id)
            uploadRepository.createTask(task)

            true
        }
    }
}
