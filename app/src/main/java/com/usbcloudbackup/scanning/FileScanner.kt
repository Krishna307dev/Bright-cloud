package com.usbcloudbackup.scanning

import android.util.Log
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.policy.BackupPolicyEngine
import com.usbcloudbackup.storage.UsbStorageSource
import java.io.IOException

class FileScanner(
    private val fileRepository: FileRepository,
    private val jobRepository: BackupJobRepository
) {
    companion object {
        private const val TAG = "FileScanner"
    }

    suspend fun scanSource(jobId: String, source: UsbStorageSource): List<BackupFile> {
        Log.i(TAG, "Scan started. jobId=$jobId, sourceId=${source.sourceId}, displayName=${source.displayName}")

        if (!source.isAvailable()) {
            val msg = "Scan failed: UsbStorageSource is unavailable. sourceId=${source.sourceId}"
            Log.e(TAG, msg)
            throw IOException(msg)
        }

        val descriptors = source.discoverFiles()
        val validDescriptors = descriptors.filter { !BackupPolicyEngine.isExcludedFile(it.originalName) }
        Log.i(TAG, "Discovered ${validDescriptors.size} file descriptors (${descriptors.size - validDescriptors.size} excluded). jobId=$jobId, sourceId=${source.sourceId}")

        val discoveredFiles = validDescriptors.map { desc ->
            val ext = BackupPolicyEngine.extractExtension(desc.originalName)
            val mode = BackupPolicyEngine.classifyFile(desc.originalName)
            BackupFile(
                jobId = jobId,
                sourceId = source.sourceId,
                relativePath = desc.relativePath,
                originalName = desc.originalName,
                extension = ext,
                size = desc.size,
                lastModified = desc.lastModified,
                mimeType = desc.mimeType,
                backupMode = mode.name,
                requestStatus = "NONE",
                status = FileStatus.DISCOVERED
            )
        }

        val insertedIds = fileRepository.addDiscoveredFiles(discoveredFiles)
        val persistedFiles = discoveredFiles.mapIndexed { index, file ->
            file.copy(id = insertedIds.getOrElse(index) { 0L })
        }

        // Update job total counter
        jobRepository.updateJobCounters(
            jobId = jobId,
            total = persistedFiles.size,
            uploaded = 0,
            skipped = 0,
            error = 0
        )

        Log.i(TAG, "Scan completed. jobId=$jobId, persistedFilesCount=${persistedFiles.size}")
        return persistedFiles
    }
}
