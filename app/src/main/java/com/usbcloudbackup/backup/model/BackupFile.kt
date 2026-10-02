package com.usbcloudbackup.backup.model

data class BackupFile(
    val id: Long = 0,
    val jobId: String,
    val sourceId: String,
    val relativePath: String,
    val originalName: String,
    val cloudFilename: String? = null,
    val sha256: String? = null,
    val size: Long,
    val lastModified: Long,
    val mimeType: String? = null,
    val status: FileStatus,
    val backupMode: String = "AUTOMATIC",
    val requestStatus: String = "NONE",
    val extension: String = "",
    val b2ObjectKey: String? = null,
    val storageBackend: String = "B2",
    val retryCount: Int = 0,
    val errorMessage: String? = null
)
