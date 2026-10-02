package com.usbcloudbackup.backup

import android.util.Log
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository

sealed class DeduplicationResult {
    data class SkippedDuplicate(val existingFileId: Long, val sha256: String) : DeduplicationResult()
    data class NewContent(val sha256: String) : DeduplicationResult()
}

class DeduplicationEngine(
    private val fileRepository: FileRepository,
    private val jobRepository: BackupJobRepository
) {
    companion object {
        private const val TAG = "DeduplicationEngine"
    }

    suspend fun checkLocalDeduplication(file: BackupFile): DeduplicationResult {
        val hash = file.sha256
        checkNotNull(hash) { "File must be hashed before deduplication check. fileId=${file.id}" }

        Log.i(TAG, "Deduplication check started. fileId=${file.id}, originalName=${file.originalName}, sha256=$hash")

        val existingFile = fileRepository.findValidDuplicateBySha256(hash)

        // Only INDEXED and UPLOADED_NOT_INDEXED qualify as valid duplicate sources
        if (existingFile != null && existingFile.id != file.id && (
                existingFile.status == FileStatus.INDEXED ||
                existingFile.status == FileStatus.UPLOADED_NOT_INDEXED
            )
        ) {
            Log.i(TAG, "Duplicate hash found! Skipping upload for fileId=${file.id}, originalName=${file.originalName}, duplicateOfFileId=${existingFile.id}")

            fileRepository.updateFileStatus(file.id, FileStatus.SKIPPED_DUPLICATE)
            jobRepository.incrementSkipped(file.jobId)

            return DeduplicationResult.SkippedDuplicate(existingFile.id, hash)
        }

        Log.i(TAG, "New content hash verified. Proceeding for fileId=${file.id}, originalName=${file.originalName}")
        return DeduplicationResult.NewContent(hash)
    }
}
