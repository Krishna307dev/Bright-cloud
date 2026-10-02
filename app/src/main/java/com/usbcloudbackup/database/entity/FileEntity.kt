package com.usbcloudbackup.database.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.usbcloudbackup.backup.model.FileStatus

@Entity(
    tableName = "files",
    foreignKeys = [
        ForeignKey(
            entity = BackupJobEntity::class,
            parentColumns = ["jobId"],
            childColumns = ["jobId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["jobId", "status"]),
        Index(value = ["sha256"]),
        Index(value = ["sourceId", "relativePath", "originalName"]),
        Index(value = ["sourceId", "requestStatus"])
    ]
)
data class FileEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val jobId: String,
    val sourceId: String,
    val relativePath: String, // Relative path from USB root (e.g., "Notes/Math/")
    val originalName: String,
    val cloudFilename: String? = null, // Set after name reservation (e.g. "CHAPTER_5(1).pdf")
    val sha256: String? = null, // 64-character lowercase hex string
    val size: Long,
    val lastModified: Long,
    val mimeType: String? = null,
    val status: FileStatus,
    val backupMode: String = "AUTOMATIC",
    val requestStatus: String = "NONE",
    val extension: String = "",
    val b2ObjectKey: String? = null, // Full Backblaze B2 object key
    val storageBackend: String = "B2",
    val retryCount: Int = 0,
    val errorMessage: String? = null
)
