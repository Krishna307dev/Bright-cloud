package com.usbcloudbackup.database.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.usbcloudbackup.backup.model.UploadTaskState

@Entity(
    tableName = "upload_tasks",
    foreignKeys = [
        ForeignKey(
            entity = FileEntity::class,
            parentColumns = ["id"],
            childColumns = ["fileId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["fileId"]),
        Index(value = ["state"]),
        Index(value = ["reservationId"])
    ]
)
data class UploadTaskEntity(
    @PrimaryKey val taskId: String, // UUID string
    val fileId: Long,
    val state: UploadTaskState,
    val b2ObjectKey: String,
    val uploadSessionUri: String? = null, // Resumable upload URL
    val reservationId: String, // Firestore nameReservation document ID
    val sha256: String,
    val bytesTransferred: Long = 0,
    val totalBytes: Long = 0,
    val updatedAt: Long
)
