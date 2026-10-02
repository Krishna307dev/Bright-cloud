package com.usbcloudbackup.backup.model

data class UploadTask(
    val taskId: String,
    val fileId: Long,
    val state: UploadTaskState,
    val b2ObjectKey: String,
    val uploadSessionUri: String? = null,
    val reservationId: String,
    val sha256: String,
    val bytesTransferred: Long = 0,
    val totalBytes: Long = 0,
    val updatedAt: Long
)
