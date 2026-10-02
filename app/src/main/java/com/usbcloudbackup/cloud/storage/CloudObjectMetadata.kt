package com.usbcloudbackup.cloud.storage

data class CloudObjectMetadata(
    val cloudObjectPath: String,
    val sha256: String?,
    val size: Long,
    val sourceId: String?,
    val originalName: String?,
    val fileId: String?
)
