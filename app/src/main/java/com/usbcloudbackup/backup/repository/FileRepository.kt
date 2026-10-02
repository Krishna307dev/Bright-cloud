package com.usbcloudbackup.backup.repository

import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.toDomain
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.database.dao.FileDao

class FileRepository(private val fileDao: FileDao) {

    suspend fun addDiscoveredFile(file: BackupFile): Long {
        return fileDao.insertFile(file.toEntity())
    }

    suspend fun addDiscoveredFiles(files: List<BackupFile>): List<Long> {
        return fileDao.insertFiles(files.map { it.toEntity() })
    }

    suspend fun updateFileStatus(fileId: Long, newStatus: FileStatus, errorMessage: String? = null) {
        val currentFile = fileDao.getFileById(fileId)
        if (currentFile != null) {
            val validatedStatus = currentFile.status.transitionTo(newStatus)
            fileDao.updateFileStatus(fileId, validatedStatus, errorMessage)
        } else {
            fileDao.updateFileStatus(fileId, newStatus, errorMessage)
        }
    }

    suspend fun updateFileHash(fileId: Long, sha256: String, newStatus: FileStatus) {
        val currentFile = fileDao.getFileById(fileId)
        val validatedStatus = currentFile?.status?.transitionTo(newStatus) ?: newStatus
        fileDao.updateFileHash(fileId, sha256, validatedStatus)
    }

    suspend fun updateFileCloudInfo(fileId: Long, cloudFilename: String, b2ObjectKey: String, newStatus: FileStatus) {
        val currentFile = fileDao.getFileById(fileId)
        val validatedStatus = currentFile?.status?.transitionTo(newStatus) ?: newStatus
        fileDao.updateFileCloudInfo(fileId, cloudFilename, b2ObjectKey, validatedStatus)
    }

    suspend fun getFile(fileId: Long): BackupFile? {
        return fileDao.getFileById(fileId)?.toDomain()
    }

    suspend fun getFilesForJob(jobId: String): List<BackupFile> {
        return fileDao.getFilesForJob(jobId).map { it.toDomain() }
    }

    suspend fun getFilesByJobAndStatus(jobId: String, status: FileStatus): List<BackupFile> {
        return fileDao.getFilesByJobAndStatus(jobId, status).map { it.toDomain() }
    }

    suspend fun findExistingFileByHash(sha256: String): BackupFile? {
        return fileDao.findFileBySha256(sha256)?.toDomain()
    }

    suspend fun findValidDuplicateBySha256(sha256: String): BackupFile? {
        return fileDao.findValidDuplicateBySha256(sha256)?.toDomain()
    }

    suspend fun findExistingFileByPath(sourceId: String, relativePath: String, originalName: String): BackupFile? {
        return fileDao.findExistingFileByPath(sourceId, relativePath, originalName)?.toDomain()
    }

    suspend fun findExistingFileByStoredName(sourceId: String, relativePath: String, storedName: String, excludeFileId: Long = 0L): BackupFile? {
        return fileDao.findExistingFileByStoredName(sourceId, relativePath, storedName, excludeFileId)?.toDomain()
    }

    suspend fun countFilesByJobAndStatus(jobId: String, status: FileStatus): Int {
        return fileDao.countFilesByJobAndStatus(jobId, status)
    }

    suspend fun getInterruptedFiles(): List<BackupFile> {
        return fileDao.getInterruptedFiles().map { it.toDomain() }
    }
}
