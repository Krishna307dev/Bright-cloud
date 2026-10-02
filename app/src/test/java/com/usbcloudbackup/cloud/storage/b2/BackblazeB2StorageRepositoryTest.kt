package com.usbcloudbackup.cloud.storage.b2

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BackblazeB2StorageRepositoryTest {

    private lateinit var serverSocket: ServerSocket
    private var serverPort: Int = 0
    private val running = AtomicBoolean(true)
    private val uploadedBytes = ByteArrayOutputStream()
    private val receivedHeaders = mutableMapOf<String, String>()
    private var lastReceivedBytesTotal: Long = 0L
    private var lastReceivedDigest: String = ""

    @Before
    fun setup() {
        uploadedBytes.reset()
        receivedHeaders.clear()
        lastReceivedBytesTotal = 0L
        lastReceivedDigest = ""
        serverSocket = ServerSocket()
        serverSocket.bind(InetSocketAddress("127.0.0.1", 0))
        serverPort = serverSocket.localPort

        Thread {
            while (running.get()) {
                try {
                    val socket: Socket = serverSocket.accept()
                    handleSocket(socket)
                } catch (e: Exception) {
                    if (!running.get()) break
                }
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    private fun handleSocket(socket: Socket) {
        try {
            val input = socket.getInputStream()
            val headerBytes = ByteArrayOutputStream()
            var prev1 = -1
            var prev2 = -1
            var prev3 = -1
            var b: Int
            while (input.read().also { b = it } != -1) {
                headerBytes.write(b)
                if (prev3 == '\r'.code && prev2 == '\n'.code && prev1 == '\r'.code && b == '\n'.code) {
                    break
                }
                prev3 = prev2
                prev2 = prev1
                prev1 = b
            }

            val headerStr = headerBytes.toString("US-ASCII")
            val lines = headerStr.split("\r\n")
            if (lines.isEmpty()) return
            val firstLine = lines[0]
            val parts = firstLine.split(" ")
            val method = parts.getOrNull(0) ?: ""
            val path = parts.getOrNull(1) ?: ""

            var contentLength = -1L
            for (line in lines.drop(1)) {
                if (line.isBlank()) continue
                val headerParts = line.split(":", limit = 2)
                if (headerParts.size == 2) {
                    val key = headerParts[0].trim().lowercase()
                    val value = headerParts[1].trim()
                    receivedHeaders[key] = value
                    if (key == "content-length") {
                        contentLength = value.toLongOrNull() ?: -1L
                    }
                }
            }

            val output: OutputStream = socket.getOutputStream()

            if (method == "PUT") {
                val digest = java.security.MessageDigest.getInstance("SHA-256")
                val buf = ByteArray(65536)
                var bytesReadTotal = 0L

                if (contentLength >= 0) {
                    while (bytesReadTotal < contentLength) {
                        val toRead = Math.min(buf.size.toLong(), contentLength - bytesReadTotal).toInt()
                        val r = input.read(buf, 0, toRead)
                        if (r == -1) break
                        digest.update(buf, 0, r)
                        if (bytesReadTotal + r <= 1024 * 1024) {
                            uploadedBytes.write(buf, 0, r)
                        }
                        bytesReadTotal += r
                    }
                } else if (receivedHeaders["transfer-encoding"]?.equals("chunked", ignoreCase = true) == true) {
                    // Read chunked encoding
                    var chunkSize = -1
                    while (true) {
                        var chunkHeaderLine = ""
                        var c: Int
                        while (input.read().also { c = it } != -1) {
                            if (c == '\n'.code) break
                            if (c != '\r'.code) chunkHeaderLine += c.toChar()
                        }
                        if (chunkHeaderLine.isBlank()) break
                        chunkSize = chunkHeaderLine.trim().split(";")[0].toInt(16)
                        if (chunkSize == 0) {
                            // trailing CRLF
                            input.read()
                            input.read()
                            break
                        }
                        var chunkRead = 0
                        while (chunkRead < chunkSize) {
                            val toRead = Math.min(buf.size, chunkSize - chunkRead)
                            val r = input.read(buf, 0, toRead)
                            if (r == -1) break
                            digest.update(buf, 0, r)
                            if (bytesReadTotal + r <= 1024 * 1024) {
                                uploadedBytes.write(buf, 0, r)
                            }
                            chunkRead += r
                            bytesReadTotal += r
                        }
                        // consume trailing CRLF of chunk
                        input.read()
                        input.read()
                    }
                }

                lastReceivedBytesTotal = bytesReadTotal
                lastReceivedDigest = digest.digest().joinToString("") { "%02x".format(it) }

                val response = "HTTP/1.1 200 OK\r\nETag: \"b2-etag-12345\"\r\nContent-Length: 0\r\n\r\n"
                output.write(response.toByteArray(Charsets.US_ASCII))
                output.flush()
            } else if (method == "HEAD") {
                if (path.contains("missing.file")) {
                    val response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"
                    output.write(response.toByteArray(Charsets.US_ASCII))
                    output.flush()
                } else {
                    val response = "HTTP/1.1 200 OK\r\nContent-Length: 2048\r\nx-amz-meta-sha256: sha256_b2_mock_123\r\nx-amz-meta-source-id: src_b2_1\r\nx-amz-meta-original-name: photo.jpg\r\nx-amz-meta-file-id: 77\r\n\r\n"
                    output.write(response.toByteArray(Charsets.US_ASCII))
                    output.flush()
                }
            } else if (method == "DELETE") {
                val response = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n"
                output.write(response.toByteArray(Charsets.US_ASCII))
                output.flush()
            } else {
                val response = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n"
                output.write(response.toByteArray(Charsets.US_ASCII))
                output.flush()
            }
            socket.close()
        } catch (e: Exception) {
            // Ignored in test mock server
        }
    }

    @After
    fun teardown() {
        running.set(false)
        try {
            serverSocket.close()
        } catch (e: Exception) {
            // Ignored
        }
    }

    @Test
    fun testDirectPresignedS3StreamingUploadToBackblazeB2() = runBlocking {
        val directB2Url = "http://127.0.0.1:$serverPort/BrightCloud/backups/user_b2/usb-sandisk-001/dataset.zip?X-Amz-Signature=mock_sig"

        val fakeAuthProvider = object : B2AuthorizationProvider {
            override suspend fun getUploadAuthorization(
                uid: String,
                objectKey: String,
                sha256: String,
                sourceId: String,
                originalName: String,
                fileId: String
            ): B2UploadAuthorization {
                return B2UploadAuthorization(
                    uploadUrl = directB2Url,
                    headers = mapOf(
                        "x-amz-meta-sha256" to sha256,
                        "x-amz-meta-source-id" to sourceId,
                        "x-amz-meta-original-name" to originalName,
                        "x-amz-meta-file-id" to fileId
                    )
                )
            }

            override suspend fun getHeadAuthorization(
                uid: String,
                objectKey: String
            ): B2HeadAuthorization {
                return B2HeadAuthorization(headUrl = directB2Url)
            }

            override suspend fun getDeleteAuthorization(
                uid: String,
                objectKey: String
            ): B2DeleteAuthorization {
                return B2DeleteAuthorization(deleteUrl = directB2Url)
            }
        }

        val repository = BackblazeB2StorageRepository(fakeAuthProvider)

        val payloadData = ByteArray(128 * 1024) { (it % 256).toByte() }
        var progressReported = false

        val result = repository.uploadFileStream(
            cloudObjectPath = "backups/user_b2/usb-sandisk-001/dataset.zip",
            inputStream = ByteArrayInputStream(payloadData),
            metadata = mapOf(
                "x-amz-meta-sha256" to "sha256_b2_mock_123",
                "x-amz-meta-source-id" to "usb-sandisk-001",
                "x-amz-meta-original-name" to "dataset.zip",
                "x-amz-meta-file-id" to "555"
            ),
            onProgress = { uploaded, _ ->
                if (uploaded == 128 * 1024L) progressReported = true
            }
        )

        assertEquals("backups/user_b2/usb-sandisk-001/dataset.zip", result.cloudObjectPath)
        assertEquals(128 * 1024L, result.bytesUploaded)
        assertEquals(128 * 1024, uploadedBytes.size())
        assertTrue(progressReported)
        assertEquals("sha256_b2_mock_123", receivedHeaders["x-amz-meta-sha256"])
        assertEquals("usb-sandisk-001", receivedHeaders["x-amz-meta-source-id"])
        assertEquals("dataset.zip", receivedHeaders["x-amz-meta-original-name"])
        assertEquals("555", receivedHeaders["x-amz-meta-file-id"])
    }

    @Test
    fun testHeadObjectExistsReturnsMetadataFromB2() = runBlocking {
        val directB2Url = "http://127.0.0.1:$serverPort/BrightCloud/backups/user_b2/src_b2_1/photo.jpg?X-Amz-Signature=mock_head_sig"

        val fakeAuthProvider = object : B2AuthorizationProvider {
            override suspend fun getUploadAuthorization(
                uid: String,
                objectKey: String,
                sha256: String,
                sourceId: String,
                originalName: String,
                fileId: String
            ): B2UploadAuthorization = error("Not called")

            override suspend fun getHeadAuthorization(
                uid: String,
                objectKey: String
            ): B2HeadAuthorization = B2HeadAuthorization(headUrl = directB2Url)

            override suspend fun getDeleteAuthorization(
                uid: String,
                objectKey: String
            ): B2DeleteAuthorization = B2DeleteAuthorization(deleteUrl = directB2Url)
        }

        val repository = BackblazeB2StorageRepository(fakeAuthProvider)
        val meta = repository.checkObjectExists("backups/user_b2/src_b2_1/photo.jpg")

        assertNotNull(meta)
        assertEquals(2048L, meta!!.size)
        assertEquals("sha256_b2_mock_123", meta.sha256)
        assertEquals("src_b2_1", meta.sourceId)
        assertEquals("photo.jpg", meta.originalName)
        assertEquals("77", meta.fileId)
    }

    @Test
    fun testHeadObjectNotFoundReturnsNull() = runBlocking {
        val directB2Url = "http://127.0.0.1:$serverPort/BrightCloud/backups/user_b2/src_b2_1/missing.file?X-Amz-Signature=mock_head_sig"

        val fakeAuthProvider = object : B2AuthorizationProvider {
            override suspend fun getUploadAuthorization(
                uid: String,
                objectKey: String,
                sha256: String,
                sourceId: String,
                originalName: String,
                fileId: String
            ): B2UploadAuthorization = error("Not called")

            override suspend fun getHeadAuthorization(
                uid: String,
                objectKey: String
            ): B2HeadAuthorization = B2HeadAuthorization(headUrl = directB2Url)

            override suspend fun getDeleteAuthorization(
                uid: String,
                objectKey: String
            ): B2DeleteAuthorization = B2DeleteAuthorization(deleteUrl = directB2Url)
        }

        val repository = BackblazeB2StorageRepository(fakeAuthProvider)
        val meta = repository.checkObjectExists("backups/user_b2/src_b2_1/missing.file")

        assertNull(meta)
    }

    @Test
    fun testDeleteObjectDirectS3Request() = runBlocking {
        val directB2Url = "http://127.0.0.1:$serverPort/BrightCloud/backups/user_b2/src_b2_1/redundant.file?X-Amz-Signature=mock_delete_sig"

        val fakeAuthProvider = object : B2AuthorizationProvider {
            override suspend fun getUploadAuthorization(
                uid: String,
                objectKey: String,
                sha256: String,
                sourceId: String,
                originalName: String,
                fileId: String
            ): B2UploadAuthorization = error("Not called")

            override suspend fun getHeadAuthorization(
                uid: String,
                objectKey: String
            ): B2HeadAuthorization = error("Not called")

            override suspend fun getDeleteAuthorization(
                uid: String,
                objectKey: String
            ): B2DeleteAuthorization = B2DeleteAuthorization(deleteUrl = directB2Url)
        }

        val repository = BackblazeB2StorageRepository(fakeAuthProvider)
        val deleted = repository.deleteObject("backups/user_b2/src_b2_1/redundant.file")

        assertTrue(deleted)
    }

    @Test
    fun testLargeFileStreamingUploadDoesNotExceedHeap() = runBlocking {
        val directB2Url = "http://127.0.0.1:$serverPort/BrightCloud/backups/user_b2/src_b2_1/large.bin?X-Amz-Signature=mock_sig"
        val fakeAuthProvider = object : B2AuthorizationProvider {
            override suspend fun getUploadAuthorization(
                uid: String,
                objectKey: String,
                sha256: String,
                sourceId: String,
                originalName: String,
                fileId: String
            ): B2UploadAuthorization = B2UploadAuthorization(uploadUrl = directB2Url)

            override suspend fun getHeadAuthorization(uid: String, objectKey: String): B2HeadAuthorization = error("Not called")
            override suspend fun getDeleteAuthorization(uid: String, objectKey: String): B2DeleteAuthorization = error("Not called")
        }

        val testSize = 10L * 1024L * 1024L // 10 MB synthetic stream
        var streamBytesGenerated = 0L
        val syntheticStream = object : java.io.InputStream() {
            override fun read(): Int {
                return if (streamBytesGenerated < testSize) {
                    streamBytesGenerated++
                    (streamBytesGenerated % 256).toInt()
                } else {
                    -1
                }
            }

            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (streamBytesGenerated >= testSize) return -1
                val toRead = Math.min(len.toLong(), testSize - streamBytesGenerated).toInt()
                for (i in 0 until toRead) {
                    b[off + i] = ((streamBytesGenerated + i) % 256).toByte()
                }
                streamBytesGenerated += toRead
                return toRead
            }
        }

        val repository = BackblazeB2StorageRepository(fakeAuthProvider)
        val result = repository.uploadFileStream(
            cloudObjectPath = "backups/user_b2/src_b2_1/large.bin",
            inputStream = syntheticStream,
            metadata = mapOf(
                "Content-Length" to testSize.toString(),
                "x-amz-meta-sha256" to "large_sha256"
            )
        )

        assertEquals(testSize, result.bytesUploaded)
        assertEquals(testSize, lastReceivedBytesTotal)
        assertEquals(testSize.toString(), receivedHeaders["content-length"])
    }

    @Test
    fun testChunkedStreamingFallbackWhenContentLengthZeroOrMissing() = runBlocking {
        val directB2Url = "http://127.0.0.1:$serverPort/BrightCloud/backups/user_b2/src_b2_1/chunked.bin?X-Amz-Signature=mock_sig"
        val fakeAuthProvider = object : B2AuthorizationProvider {
            override suspend fun getUploadAuthorization(
                uid: String,
                objectKey: String,
                sha256: String,
                sourceId: String,
                originalName: String,
                fileId: String
            ): B2UploadAuthorization = B2UploadAuthorization(uploadUrl = directB2Url)

            override suspend fun getHeadAuthorization(uid: String, objectKey: String): B2HeadAuthorization = error("Not called")
            override suspend fun getDeleteAuthorization(uid: String, objectKey: String): B2DeleteAuthorization = error("Not called")
        }

        val testPayload = ByteArray(128 * 1024) { (it % 128).toByte() } // 128 KB
        val repository = BackblazeB2StorageRepository(fakeAuthProvider)
        val result = repository.uploadFileStream(
            cloudObjectPath = "backups/user_b2/src_b2_1/chunked.bin",
            inputStream = ByteArrayInputStream(testPayload),
            metadata = mapOf(
                "x-amz-meta-sha256" to "chunked_sha256"
            )
        )

        assertEquals(testPayload.size.toLong(), result.bytesUploaded)
        assertEquals(testPayload.size.toLong(), lastReceivedBytesTotal)
        assertEquals("chunked", receivedHeaders["transfer-encoding"]?.lowercase())
    }
}
