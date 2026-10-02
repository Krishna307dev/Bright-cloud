package com.usbcloudbackup.backup.model

data class BackupJob(
    val jobId: String,
    val sourceId: String,
    val state: BackupJobState,
    val startedAt: Long,
    val completedAt: Long? = null,
    val totalFiles: Int = 0,
    val uploadedFiles: Int = 0,
    val skippedFiles: Int = 0,
    val errorFiles: Int = 0
)
