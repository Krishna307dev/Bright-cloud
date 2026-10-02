package com.usbcloudbackup.backup.repository

import com.usbcloudbackup.backup.model.UploadTask
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.model.toDomain
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.database.dao.UploadTaskDao

class UploadRepository(private val uploadTaskDao: UploadTaskDao) {

    suspend fun createTask(task: UploadTask) {
        uploadTaskDao.insertTask(task.toEntity())
    }

    suspend fun updateTaskState(taskId: String, newState: UploadTaskState, updatedAt: Long = System.currentTimeMillis()) {
        val currentTask = uploadTaskDao.getTaskById(taskId)
        val validatedState = currentTask?.state?.transitionTo(newState) ?: newState
        uploadTaskDao.updateTaskState(taskId, validatedState, updatedAt)
    }

    suspend fun updateSessionUri(taskId: String, sessionUri: String?, updatedAt: Long = System.currentTimeMillis()) {
        uploadTaskDao.updateUploadSessionUri(taskId, sessionUri, updatedAt)
    }

    suspend fun updateProgress(taskId: String, bytesTransferred: Long, totalBytes: Long, updatedAt: Long = System.currentTimeMillis()) {
        uploadTaskDao.updateProgress(taskId, bytesTransferred, totalBytes, updatedAt)
    }

    suspend fun getTask(taskId: String): UploadTask? {
        return uploadTaskDao.getTaskById(taskId)?.toDomain()
    }

    suspend fun getTaskForFile(fileId: Long): UploadTask? {
        return uploadTaskDao.getTaskForFile(fileId)?.toDomain()
    }

    suspend fun deleteTaskForFile(fileId: Long) {
        uploadTaskDao.deleteTaskForFile(fileId)
    }

    suspend fun getUnfinishedTasks(): List<UploadTask> {
        return uploadTaskDao.getUnfinishedTasks().map { it.toDomain() }
    }
}
