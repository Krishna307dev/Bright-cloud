package com.usbcloudbackup.database.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.usbcloudbackup.backup.model.BackupJobState

@Entity(
    tableName = "backup_jobs",
    foreignKeys = [
        ForeignKey(
            entity = SourceEntity::class,
            parentColumns = ["sourceId"],
            childColumns = ["sourceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["sourceId"]),
        Index(value = ["state"])
    ]
)
data class BackupJobEntity(
    @PrimaryKey val jobId: String, // UUID
    val sourceId: String,
    val state: BackupJobState,
    val startedAt: Long,
    val completedAt: Long? = null,
    val totalFiles: Int = 0,
    val uploadedFiles: Int = 0,
    val skippedFiles: Int = 0,
    val errorFiles: Int = 0
)
