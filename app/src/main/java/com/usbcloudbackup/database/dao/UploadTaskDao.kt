package com.usbcloudbackup.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.database.entity.UploadTaskEntity

@Dao
interface UploadTaskDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTask(task: UploadTaskEntity)

    @Update
    suspend fun updateTask(task: UploadTaskEntity)

    @Query("UPDATE upload_tasks SET state = :state, updatedAt = :updatedAt WHERE taskId = :taskId")
    suspend fun updateTaskState(taskId: String, state: UploadTaskState, updatedAt: Long)

    @Query("UPDATE upload_tasks SET uploadSessionUri = :sessionUri, updatedAt = :updatedAt WHERE taskId = :taskId")
    suspend fun updateUploadSessionUri(taskId: String, sessionUri: String?, updatedAt: Long)

    @Query("UPDATE upload_tasks SET bytesTransferred = :bytesTransferred, totalBytes = :totalBytes, updatedAt = :updatedAt WHERE taskId = :taskId")
    suspend fun updateProgress(taskId: String, bytesTransferred: Long, totalBytes: Long, updatedAt: Long)

    @Query("SELECT * FROM upload_tasks WHERE taskId = :taskId")
    suspend fun getTaskById(taskId: String): UploadTaskEntity?

    @Query("SELECT * FROM upload_tasks WHERE fileId = :fileId")
    suspend fun getTaskForFile(fileId: Long): UploadTaskEntity?

    @Query("DELETE FROM upload_tasks WHERE fileId = :fileId")
    suspend fun deleteTaskForFile(fileId: Long)

    @Query("SELECT * FROM upload_tasks WHERE state = :state")
    suspend fun getTasksByState(state: UploadTaskState): List<UploadTaskEntity>

    @Query("SELECT * FROM upload_tasks WHERE state NOT IN ('INDEXED', 'FAILED')")
    suspend fun getUnfinishedTasks(): List<UploadTaskEntity>
}
