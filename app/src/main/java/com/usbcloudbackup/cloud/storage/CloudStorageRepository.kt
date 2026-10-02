package com.usbcloudbackup.cloud.storage

import java.io.InputStream

data class UploadResult(
    val cloudObjectPath: String,
    val sessionUri: String?,
    val bytesUploaded: Long
)

interface CloudStorageRepository {
    suspend fun uploadFileStream(
        cloudObjectPath: String,
        inputStream: InputStream,
        metadata: Map<String, String>,
        sessionUri: String? = null,
        onProgress: ((bytesUploaded: Long, totalBytes: Long) -> Unit)? = null
    ): UploadResult

    suspend fun checkObjectExists(cloudObjectPath: String): CloudObjectMetadata?
 
    suspend fun deleteObject(cloudObjectPath: String): Boolean
}
