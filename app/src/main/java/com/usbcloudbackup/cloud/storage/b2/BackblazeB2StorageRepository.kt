package com.usbcloudbackup.cloud.storage.b2

import android.util.Log
import com.usbcloudbackup.cloud.storage.CloudObjectMetadata
import com.usbcloudbackup.cloud.storage.CloudStorageRepository
import com.usbcloudbackup.cloud.storage.UploadResult
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class BackblazeB2StorageRepository(
    private val authorizationProvider: B2AuthorizationProvider = DefaultB2AuthorizationProvider()
) : CloudStorageRepository {

    companion object {
        private const val TAG = "BackblazeB2StorageRepo"
        private const val BUFFER_SIZE = 64 * 1024 // 64 KB bounded streaming buffer
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 30_000
    }

    override suspend fun uploadFileStream(
        cloudObjectPath: String,
        inputStream: InputStream,
        metadata: Map<String, String>,
        sessionUri: String?,
        onProgress: ((bytesUploaded: Long, totalBytes: Long) -> Unit)?
    ): UploadResult = withContext(Dispatchers.IO) {
        val sha256 = metadata["x-amz-meta-sha256"] ?: metadata["x-custom-sha256"] ?: ""
        val sourceId = metadata["x-amz-meta-source-id"] ?: metadata["x-custom-source-id"] ?: ""
        val originalName = metadata["x-amz-meta-original-name"] ?: metadata["x-custom-original-name"] ?: ""
        val fileId = metadata["x-amz-meta-file-id"] ?: metadata["x-custom-file-id"] ?: ""

        val uid = extractUidFromKey(cloudObjectPath)

        val auth = authorizationProvider.getUploadAuthorization(
            uid = uid,
            objectKey = cloudObjectPath,
            sha256 = sha256,
            sourceId = sourceId,
            originalName = originalName,
            fileId = fileId
        )

        val contentLength = metadata["Content-Length"]?.toLongOrNull()
            ?: metadata["x-custom-file-size"]?.toLongOrNull()

        Log.i(TAG, "Starting direct streaming Backblaze B2 S3 upload. objectKey=$cloudObjectPath, contentLength=$contentLength")

        val url = URL(auth.uploadUrl)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "PUT"
            doOutput = true
            if (contentLength != null && contentLength >= 0L) {
                setFixedLengthStreamingMode(contentLength)
                setRequestProperty("Content-Length", contentLength.toString())
            } else {
                setChunkedStreamingMode(BUFFER_SIZE)
            }
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS

            // Set S3 user metadata headers
            setRequestProperty("x-amz-meta-sha256", sha256)
            setRequestProperty("x-amz-meta-source-id", sourceId)
            setRequestProperty("x-amz-meta-original-name", originalName)
            setRequestProperty("x-amz-meta-file-id", fileId)
            setRequestProperty("Content-Type", "application/octet-stream")

            // Additional headers from authorization provider
            for ((key, value) in auth.headers) {
                setRequestProperty(key, value)
            }
        }

        var totalBytesUploaded = 0L
        try {
            connection.outputStream.use { outputStream ->
                val buffer = ByteArray(BUFFER_SIZE)
                var bytesRead: Int
                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    outputStream.write(buffer, 0, bytesRead)
                    totalBytesUploaded += bytesRead
                    onProgress?.invoke(totalBytesUploaded, totalBytesUploaded)
                }
                outputStream.flush()
            }

            val responseCode = connection.responseCode
            if (responseCode !in 200..299) {
                val errorMsg = "Backblaze B2 upload failed with HTTP status $responseCode: ${connection.responseMessage}"
                Log.e(TAG, errorMsg)
                throw IOException(errorMsg)
            }

            Log.i(TAG, "Backblaze B2 streaming upload complete. objectKey=$cloudObjectPath, bytesUploaded=$totalBytesUploaded")

            UploadResult(
                cloudObjectPath = cloudObjectPath,
                sessionUri = null,
                bytesUploaded = totalBytesUploaded
            )
        } finally {
            connection.disconnect()
        }
    }

    override suspend fun checkObjectExists(cloudObjectPath: String): CloudObjectMetadata? = withContext(Dispatchers.IO) {
        val uid = extractUidFromKey(cloudObjectPath)
        val auth = authorizationProvider.getHeadAuthorization(uid = uid, objectKey = cloudObjectPath)

        val url = URL(auth.headUrl)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "HEAD"
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS

            for ((key, value) in auth.headers) {
                setRequestProperty(key, value)
            }
        }

        try {
            val responseCode = connection.responseCode
            if (responseCode == HttpURLConnection.HTTP_NOT_FOUND) {
                Log.d(TAG, "Backblaze B2 object not found. key=$cloudObjectPath")
                return@withContext null
            }

            if (responseCode !in 200..299) {
                Log.w(TAG, "Backblaze B2 HEAD check returned HTTP $responseCode for $cloudObjectPath")
                return@withContext null
            }

            val contentLength = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: 0L
            val sha256 = connection.getHeaderField("x-amz-meta-sha256")
                ?: connection.getHeaderField("x-custom-sha256")
            val sourceId = connection.getHeaderField("x-amz-meta-source-id")
                ?: connection.getHeaderField("x-custom-source-id")
            val originalName = connection.getHeaderField("x-amz-meta-original-name")
                ?: connection.getHeaderField("x-custom-original-name")
            val fileId = connection.getHeaderField("x-amz-meta-file-id")
                ?: connection.getHeaderField("x-custom-file-id")

            Log.i(TAG, "Backblaze B2 object exists. key=$cloudObjectPath, size=$contentLength, sha256=$sha256")

            CloudObjectMetadata(
                cloudObjectPath = cloudObjectPath,
                sha256 = sha256,
                size = contentLength,
                sourceId = sourceId,
                originalName = originalName,
                fileId = fileId
            )
        } catch (e: IOException) {
            Log.w(TAG, "Network error during Backblaze B2 checkObjectExists for $cloudObjectPath: ${e.message}")
            throw e
        } finally {
            connection.disconnect()
        }
    }

    override suspend fun deleteObject(cloudObjectPath: String): Boolean = withContext(Dispatchers.IO) {
        val uid = extractUidFromKey(cloudObjectPath)
        val deleteAuth = authorizationProvider.getDeleteAuthorization(uid, cloudObjectPath)
        val url = URL(deleteAuth.deleteUrl)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "DELETE"
            connectTimeout = 15_000
            readTimeout = 15_000
        }

        try {
            val responseCode = connection.responseCode
            // HTTP 204 No Content, 200 OK, or 404 (already deleted) are successful deletion states in S3
            if (responseCode in 200..299 || responseCode == 404) {
                Log.i(TAG, "Successfully deleted redundant Backblaze B2 object: $cloudObjectPath (HTTP $responseCode)")
                true
            } else {
                Log.w(TAG, "Failed to delete Backblaze B2 object: $cloudObjectPath, HTTP $responseCode")
                false
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error deleting Backblaze B2 object $cloudObjectPath: ${e.message}")
            false
        } finally {
            connection.disconnect()
        }
    }

    private fun extractUidFromKey(objectKey: String): String {
        val parts = objectKey.split("/")
        return if (parts.size >= 2 && parts[0] == "backups") {
            parts[1]
        } else {
            "unknown"
        }
    }
}
