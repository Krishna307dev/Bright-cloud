package com.usbcloudbackup.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.database.entity.BackupJobEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface BackupJobDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertJob(job: BackupJobEntity)

    @Update
    suspend fun updateJob(job: BackupJobEntity)

    @Query("UPDATE backup_jobs SET state = :state, completedAt = :completedAt WHERE jobId = :jobId")
    suspend fun updateJobState(jobId: String, state: BackupJobState, completedAt: Long? = null)

    @Query("UPDATE backup_jobs SET totalFiles = :total, uploadedFiles = :uploaded, skippedFiles = :skipped, errorFiles = :error WHERE jobId = :jobId")
    suspend fun updateJobCounters(jobId: String, total: Int, uploaded: Int, skipped: Int, error: Int)

    @Query("UPDATE backup_jobs SET uploadedFiles = uploadedFiles + 1 WHERE jobId = :jobId")
    suspend fun incrementUploadedCount(jobId: String)

    @Query("UPDATE backup_jobs SET skippedFiles = skippedFiles + 1 WHERE jobId = :jobId")
    suspend fun incrementSkippedCount(jobId: String)

    @Query("UPDATE backup_jobs SET errorFiles = errorFiles + 1 WHERE jobId = :jobId")
    suspend fun incrementErrorCount(jobId: String)

    @Query("SELECT * FROM backup_jobs WHERE jobId = :jobId")
    suspend fun getJobById(jobId: String): BackupJobEntity?

    @Query("SELECT * FROM backup_jobs WHERE jobId = :jobId")
    fun observeJobById(jobId: String): Flow<BackupJobEntity?>

    @Query("SELECT * FROM backup_jobs WHERE sourceId = :sourceId ORDER BY startedAt DESC")
    suspend fun getJobsForSource(sourceId: String): List<BackupJobEntity>

    @Query("SELECT * FROM backup_jobs WHERE sourceId = :sourceId AND state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') ORDER BY startedAt DESC")
    suspend fun getIncompleteJobsForSource(sourceId: String): List<BackupJobEntity>

    @Query("SELECT * FROM backup_jobs WHERE state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') ORDER BY startedAt DESC")
    suspend fun getAllIncompleteJobs(): List<BackupJobEntity>
}
