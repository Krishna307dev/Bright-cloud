package com.usbcloudbackup.backup.repository

import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.toDomain
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.database.dao.BackupJobDao
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class BackupJobRepository(private val backupJobDao: BackupJobDao) {

    suspend fun createJob(job: BackupJob) {
        backupJobDao.insertJob(job.toEntity())
    }

    suspend fun updateJobState(jobId: String, newState: BackupJobState, completedAt: Long? = null) {
        val currentJob = backupJobDao.getJobById(jobId)
        if (currentJob != null) {
            val validatedState = currentJob.state.transitionTo(newState)
            backupJobDao.updateJobState(jobId, validatedState, completedAt)
        } else {
            backupJobDao.updateJobState(jobId, newState, completedAt)
        }
    }

    suspend fun updateJobCounters(jobId: String, total: Int, uploaded: Int, skipped: Int, error: Int) {
        backupJobDao.updateJobCounters(jobId, total, uploaded, skipped, error)
    }

    suspend fun incrementUploaded(jobId: String) {
        backupJobDao.incrementUploadedCount(jobId)
    }

    suspend fun incrementSkipped(jobId: String) {
        backupJobDao.incrementSkippedCount(jobId)
    }

    suspend fun incrementError(jobId: String) {
        backupJobDao.incrementErrorCount(jobId)
    }

    suspend fun getJob(jobId: String): BackupJob? {
        return backupJobDao.getJobById(jobId)?.toDomain()
    }

    fun observeJob(jobId: String): Flow<BackupJob?> {
        return backupJobDao.observeJobById(jobId).map { it?.toDomain() }
    }

    suspend fun getJobsForSource(sourceId: String): List<BackupJob> {
        return backupJobDao.getJobsForSource(sourceId).map { it.toDomain() }
    }

    suspend fun getIncompleteJobsForSource(sourceId: String): List<BackupJob> {
        return backupJobDao.getIncompleteJobsForSource(sourceId).map { it.toDomain() }
    }

    suspend fun getAllIncompleteJobs(): List<BackupJob> {
        return backupJobDao.getAllIncompleteJobs().map { it.toDomain() }
    }
}
