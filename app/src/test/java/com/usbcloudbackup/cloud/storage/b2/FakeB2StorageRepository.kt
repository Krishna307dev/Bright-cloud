package com.usbcloudbackup.cloud.storage.b2

import com.usbcloudbackup.cloud.storage.CloudObjectMetadata
import com.usbcloudbackup.cloud.storage.CloudStorageRepository
import com.usbcloudbackup.cloud.storage.UploadResult
import java.io.ByteArrayOutputStream
import java.io.InputStream

class FakeB2StorageRepository : CloudStorageRepository {

    val uploadedObjects = mutableMapOf<String, ByteArray>()
    val objectMetadata = mutableMapOf<String, Map<String, String>>()
    var shouldFailUpload: Boolean = false
    var shouldFailHead: Boolean = false
    var uploadCallCount = 0
    var headCallCount = 0

    fun getStoredBytes(path: String): ByteArray? = uploadedObjects[path]
    fun getStoredMetadata(path: String): Map<String, String>? = objectMetadata[path]

    override suspend fun uploadFileStream(
        cloudObjectPath: String,
        inputStream: InputStream,
        metadata: Map<String, String>,
        sessionUri: String?,
        onProgress: ((bytesUploaded: Long, totalBytes: Long) -> Unit)?
    ): UploadResult {
        uploadCallCount++
        if (shouldFailUpload) {
            throw java.io.IOException("Simulated Backblaze B2 network error")
        }

        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var read: Int
        var total = 0L
        while (inputStream.read(buffer).also { read = it } != -1) {
            out.write(buffer, 0, read)
            total += read
            onProgress?.invoke(total, total)
        }

        val bytes = out.toByteArray()
        uploadedObjects[cloudObjectPath] = bytes
        objectMetadata[cloudObjectPath] = metadata

        return UploadResult(
            cloudObjectPath = cloudObjectPath,
            sessionUri = null,
            bytesUploaded = total
        )
    }

    override suspend fun checkObjectExists(cloudObjectPath: String): CloudObjectMetadata? {
        headCallCount++
        if (shouldFailHead) {
            throw java.io.IOException("Simulated Backblaze B2 HEAD failure")
        }

        val bytes = uploadedObjects[cloudObjectPath] ?: return null
        val meta = objectMetadata[cloudObjectPath] ?: emptyMap()

        return CloudObjectMetadata(
            cloudObjectPath = cloudObjectPath,
            sha256 = meta["x-amz-meta-sha256"] ?: meta["x-custom-sha256"],
            size = bytes.size.toLong(),
            sourceId = meta["x-amz-meta-source-id"] ?: meta["x-custom-source-id"],
            originalName = meta["x-amz-meta-original-name"] ?: meta["x-custom-original-name"],
            fileId = meta["x-amz-meta-file-id"] ?: meta["x-custom-file-id"]
        )
    }

    var deleteCallCount = 0

    override suspend fun deleteObject(cloudObjectPath: String): Boolean {
        deleteCallCount++
        objectMetadata.remove(cloudObjectPath)
        return uploadedObjects.remove(cloudObjectPath) != null
    }
}
