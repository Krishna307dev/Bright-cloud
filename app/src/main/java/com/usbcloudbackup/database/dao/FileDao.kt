package com.usbcloudbackup.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.database.entity.FileEntity

@Dao
interface FileDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFile(file: FileEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFiles(files: List<FileEntity>): List<Long>

    @Update
    suspend fun updateFile(file: FileEntity)

    @Query("UPDATE files SET status = :status, errorMessage = :errorMessage WHERE id = :fileId")
    suspend fun updateFileStatus(fileId: Long, status: FileStatus, errorMessage: String? = null)

    @Query("UPDATE files SET sha256 = :sha256, status = :status WHERE id = :fileId")
    suspend fun updateFileHash(fileId: Long, sha256: String, status: FileStatus)

    @Query("UPDATE files SET cloudFilename = :cloudFilename, b2ObjectKey = :b2ObjectKey, status = :status WHERE id = :fileId")
    suspend fun updateFileCloudInfo(fileId: Long, cloudFilename: String, b2ObjectKey: String, status: FileStatus)

    @Query("SELECT * FROM files WHERE id = :fileId")
    suspend fun getFileById(fileId: Long): FileEntity?

    @Query("SELECT * FROM files WHERE jobId = :jobId ORDER BY id ASC")
    suspend fun getFilesForJob(jobId: String): List<FileEntity>

    @Query("SELECT * FROM files WHERE jobId = :jobId AND status = :status ORDER BY id ASC")
    suspend fun getFilesByJobAndStatus(jobId: String, status: FileStatus): List<FileEntity>

    @Query("SELECT * FROM files WHERE status = :status ORDER BY id ASC")
    suspend fun getFilesByStatus(status: FileStatus): List<FileEntity>

    @Query("SELECT * FROM files WHERE sha256 = :sha256 LIMIT 1")
    suspend fun findFileBySha256(sha256: String): FileEntity?

    @Query("SELECT * FROM files WHERE sha256 = :sha256 AND status IN ('INDEXED', 'UPLOADED_NOT_INDEXED') LIMIT 1")
    suspend fun findValidDuplicateBySha256(sha256: String): FileEntity?

    @Query("SELECT * FROM files WHERE sha256 = :sha256")
    suspend fun findFilesBySha256(sha256: String): List<FileEntity>

    @Query("SELECT * FROM files WHERE sourceId = :sourceId AND relativePath = :relativePath AND originalName = :originalName LIMIT 1")
    suspend fun findExistingFileByPath(sourceId: String, relativePath: String, originalName: String): FileEntity?

    @Query("SELECT * FROM files WHERE sourceId = :sourceId AND relativePath = :relativePath AND id != :excludeFileId AND (cloudFilename = :storedName OR (cloudFilename IS NULL AND originalName = :storedName)) LIMIT 1")
    suspend fun findExistingFileByStoredName(sourceId: String, relativePath: String, storedName: String, excludeFileId: Long = 0L): FileEntity?

    @Query("SELECT COUNT(*) FROM files WHERE jobId = :jobId AND status = :status")
    suspend fun countFilesByJobAndStatus(jobId: String, status: FileStatus): Int

    @Query("SELECT * FROM files WHERE status IN ('UPLOADING', 'UPLOADED_NOT_INDEXED', 'NAME_RESERVED', 'SOURCE_UNAVAILABLE')")
    suspend fun getInterruptedFiles(): List<FileEntity>
}
