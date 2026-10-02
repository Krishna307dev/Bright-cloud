package com.usbcloudbackup.cloud.storage

import java.io.ByteArrayOutputStream
import java.io.InputStream

class FakeCloudStorageRepository : CloudStorageRepository {

    private val storageMap = mutableMapOf<String, Pair<ByteArray, Map<String, String>>>()
    private val sessionUriMap = mutableMapOf<String, String>()

    var uploadCount = 0
        private set

    var shouldFailDelete: Boolean = false

    fun getStoredObjectCount(): Int = storageMap.size

    fun getStoredBytes(path: String): ByteArray? = storageMap[path]?.first

    fun clear() {
        storageMap.clear()
        sessionUriMap.clear()
        uploadCount = 0
    }

    override suspend fun uploadFileStream(
        cloudObjectPath: String,
        inputStream: InputStream,
        metadata: Map<String, String>,
        sessionUri: String?,
        onProgress: ((bytesUploaded: Long, totalBytes: Long) -> Unit)?
    ): UploadResult {
        uploadCount++

        val baos = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        var read: Int
        var total = 0L

        inputStream.use { stream ->
            while (stream.read(buffer).also { read = it } != -1) {
                baos.write(buffer, 0, read)
                total += read
                onProgress?.invoke(total, total)
            }
        }

        val bytes = baos.toByteArray()
        storageMap[cloudObjectPath] = Pair(bytes, metadata)

        val generatedSessionUri = sessionUri ?: "https://fake.storage.upload/session/$cloudObjectPath"
        sessionUriMap[cloudObjectPath] = generatedSessionUri

        return UploadResult(
            cloudObjectPath = cloudObjectPath,
            sessionUri = generatedSessionUri,
            bytesUploaded = total
        )
    }

    override suspend fun checkObjectExists(cloudObjectPath: String): CloudObjectMetadata? {
        val entry = storageMap[cloudObjectPath] ?: return null
        val (bytes, metadata) = entry

        return CloudObjectMetadata(
            cloudObjectPath = cloudObjectPath,
            sha256 = metadata["x-custom-sha256"],
            size = bytes.size.toLong(),
            sourceId = metadata["x-custom-source-id"],
            originalName = metadata["x-custom-original-name"],
            fileId = metadata["x-custom-file-id"]
        )
    }

    override suspend fun deleteObject(cloudObjectPath: String): Boolean {
        if (shouldFailDelete) {
            throw java.io.IOException("Simulated storage delete network failure")
        }
        sessionUriMap.remove(cloudObjectPath)
        return storageMap.remove(cloudObjectPath) != null
    }
}
