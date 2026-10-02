package com.usbcloudbackup.cloud.storage.b2

import android.util.Log
import java.io.BufferedReader
import java.io.IOException
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

data class B2UploadAuthorization(
    val uploadUrl: String,
    val headers: Map<String, String> = emptyMap(),
    val expiresAt: Long = System.currentTimeMillis() + 3600_000L
)

data class B2HeadAuthorization(
    val headUrl: String,
    val headers: Map<String, String> = emptyMap(),
    val expiresAt: Long = System.currentTimeMillis() + 3600_000L
)

data class B2DeleteAuthorization(
    val deleteUrl: String,
    val expiresAt: Long = System.currentTimeMillis() + 3600_000L
)

interface B2AuthorizationProvider {
    suspend fun getUploadAuthorization(
        uid: String = "",
        objectKey: String,
        sha256: String,
        sourceId: String,
        originalName: String,
        fileId: String
    ): B2UploadAuthorization

    suspend fun getHeadAuthorization(
        uid: String = "",
        objectKey: String
    ): B2HeadAuthorization

    suspend fun getDeleteAuthorization(
        uid: String = "",
        objectKey: String
    ): B2DeleteAuthorization
}

class DefaultB2AuthorizationProvider(
    var backendBaseUrl: String = System.getProperty("b2.authorizer.url") ?: "https://usbcloudbackup-b2-authorizer.brightcloud.workers.dev",
    private val idTokenProvider: (suspend () -> String?)? = null
) : B2AuthorizationProvider {

    companion object {
        private const val TAG = "DefaultB2AuthProvider"
        private const val TIMEOUT_MS = 15_000
    }

    override suspend fun getUploadAuthorization(
        uid: String,
        objectKey: String,
        sha256: String,
        sourceId: String,
        originalName: String,
        fileId: String
    ): B2UploadAuthorization = withContext(Dispatchers.IO) {
        val endpoint = "$backendBaseUrl/b2/upload-authorize"
        try {
            val url = URL(endpoint)
            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Content-Type", "application/json")
                val idToken = idTokenProvider?.invoke()
                if (!idToken.isNullOrBlank()) {
                    setRequestProperty("Authorization", "Bearer $idToken")
                }
            }

            val requestJson = JSONObject().apply {
                put("objectKey", objectKey)
                put("sha256", sha256)
                put("sourceId", sourceId)
                put("originalName", originalName)
                put("fileId", fileId)
            }

            OutputStreamWriter(connection.outputStream, "UTF-8").use { writer ->
                writer.write(requestJson.toString())
                writer.flush()
            }

            val responseCode = connection.responseCode
            if (responseCode in 200..299) {
                val responseText = connection.inputStream.bufferedReader().use(BufferedReader::readText)
                val responseJson = JSONObject(responseText)
                val uploadUrl = responseJson.getString("uploadUrl")
                val expiresAt = responseJson.optLong("expiresAt", System.currentTimeMillis() + 3600_000L)
                val headersJson = responseJson.optJSONObject("headers")
                val headers = mutableMapOf<String, String>()
                if (headersJson != null) {
                    val keys = headersJson.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        headers[k] = headersJson.getString(k)
                    }
                }
                return@withContext B2UploadAuthorization(
                    uploadUrl = uploadUrl,
                    headers = headers,
                    expiresAt = expiresAt
                )
            } else {
                val errStream = connection.errorStream?.bufferedReader()?.use(BufferedReader::readText) ?: connection.responseMessage
                val errorMsg = "B2 upload authorization failed with HTTP $responseCode: $errStream"
                Log.e(TAG, errorMsg)
                throw IOException(errorMsg)
            }
        } catch (e: IOException) {
            throw e
        } catch (e: Exception) {
            val errorMsg = "Could not contact B2 authorization backend at $endpoint: ${e.message}"
            Log.e(TAG, errorMsg, e)
            throw IOException(errorMsg, e)
        }
    }

    override suspend fun getHeadAuthorization(
        uid: String,
        objectKey: String
    ): B2HeadAuthorization = withContext(Dispatchers.IO) {
        val endpoint = "$backendBaseUrl/b2/head-authorize"
        try {
            val url = URL(endpoint)
            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Content-Type", "application/json")
                val idToken = idTokenProvider?.invoke()
                if (!idToken.isNullOrBlank()) {
                    setRequestProperty("Authorization", "Bearer $idToken")
                }
            }

            val requestJson = JSONObject().apply {
                put("objectKey", objectKey)
            }

            OutputStreamWriter(connection.outputStream, "UTF-8").use { writer ->
                writer.write(requestJson.toString())
                writer.flush()
            }

            val responseCode = connection.responseCode
            if (responseCode in 200..299) {
                val responseText = connection.inputStream.bufferedReader().use(BufferedReader::readText)
                val responseJson = JSONObject(responseText)
                val headUrl = responseJson.getString("headUrl")
                val expiresAt = responseJson.optLong("expiresAt", System.currentTimeMillis() + 3600_000L)
                return@withContext B2HeadAuthorization(
                    headUrl = headUrl,
                    expiresAt = expiresAt
                )
            } else {
                val errStream = connection.errorStream?.bufferedReader()?.use(BufferedReader::readText) ?: connection.responseMessage
                val errorMsg = "B2 head authorization failed with HTTP $responseCode: $errStream"
                Log.e(TAG, errorMsg)
                throw IOException(errorMsg)
            }
        } catch (e: IOException) {
            throw e
        } catch (e: Exception) {
            val errorMsg = "Could not contact B2 authorization backend at $endpoint: ${e.message}"
            Log.e(TAG, errorMsg, e)
            throw IOException(errorMsg, e)
        }
    }

    override suspend fun getDeleteAuthorization(
        uid: String,
        objectKey: String
    ): B2DeleteAuthorization = withContext(Dispatchers.IO) {
        val endpoint = "$backendBaseUrl/b2/delete-authorize"
        try {
            val url = URL(endpoint)
            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Content-Type", "application/json")
                val idToken = idTokenProvider?.invoke()
                if (!idToken.isNullOrBlank()) {
                    setRequestProperty("Authorization", "Bearer $idToken")
                }
            }

            val requestJson = JSONObject().apply {
                put("objectKey", objectKey)
            }

            OutputStreamWriter(connection.outputStream, "UTF-8").use { writer ->
                writer.write(requestJson.toString())
                writer.flush()
            }

            val responseCode = connection.responseCode
            if (responseCode in 200..299) {
                val responseText = connection.inputStream.bufferedReader().use(BufferedReader::readText)
                val responseJson = JSONObject(responseText)
                val deleteUrl = responseJson.getString("deleteUrl")
                val expiresAt = responseJson.optLong("expiresAt", System.currentTimeMillis() + 3600_000L)
                return@withContext B2DeleteAuthorization(
                    deleteUrl = deleteUrl,
                    expiresAt = expiresAt
                )
            } else {
                val errStream = connection.errorStream?.bufferedReader()?.use(BufferedReader::readText) ?: connection.responseMessage
                val errorMsg = "B2 delete authorization failed with HTTP $responseCode: $errStream"
                Log.e(TAG, errorMsg)
                throw IOException(errorMsg)
            }
        } catch (e: IOException) {
            throw e
        } catch (e: Exception) {
            val errorMsg = "Could not contact B2 authorization backend at $endpoint: ${e.message}"
            Log.e(TAG, errorMsg, e)
            throw IOException(errorMsg, e)
        }
    }
}
