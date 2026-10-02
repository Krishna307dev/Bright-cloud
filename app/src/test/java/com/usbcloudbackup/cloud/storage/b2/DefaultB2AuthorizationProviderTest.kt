package com.usbcloudbackup.cloud.storage.b2

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DefaultB2AuthorizationProviderTest {

    private lateinit var serverSocket: ServerSocket
    private var serverPort: Int = 0
    private val running = AtomicBoolean(true)
    private val responseStatusCode = AtomicInteger(200)
    private var responseBody: String = "{}"

    @Before
    fun setup() {
        running.set(true)
        responseStatusCode.set(200)
        responseBody = "{}"
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

            val status = responseStatusCode.get()
            val output: OutputStream = socket.getOutputStream()
            val bodyBytes = responseBody.toByteArray(Charsets.UTF_8)
            val response = "HTTP/1.1 $status Error\r\nContent-Type: application/json\r\nContent-Length: ${bodyBytes.size}\r\n\r\n"
            output.write(response.toByteArray(Charsets.US_ASCII))
            output.write(bodyBytes)
            output.flush()
            socket.close()
        } catch (e: Exception) {
            // Ignored
        }
    }

    @After
    fun tearDown() {
        running.set(false)
        try {
            serverSocket.close()
        } catch (e: Exception) {
            // Ignored
        }
    }

    @Test
    fun testSuccessfulUploadAuthorization() = runBlocking {
        responseStatusCode.set(200)
        responseBody = """
            {
                "uploadUrl": "https://b2.mock.url/upload",
                "expiresAt": 1234567890,
                "headers": {
                    "x-amz-meta-sha256": "abc123"
                }
            }
        """.trimIndent()

        val provider = DefaultB2AuthorizationProvider(
            backendBaseUrl = "http://127.0.0.1:$serverPort"
        )

        val auth = provider.getUploadAuthorization(
            uid = "user1",
            objectKey = "backups/user1/src1/file.txt",
            sha256 = "abc123",
            sourceId = "src1",
            originalName = "file.txt",
            fileId = "1"
        )

        assertEquals("https://b2.mock.url/upload", auth.uploadUrl)
        assertEquals("abc123", auth.headers["x-amz-meta-sha256"])
        assertEquals(1234567890L, auth.expiresAt)
    }

    @Test
    fun testUploadAuthorizationThrowsOnHttp401() = runBlocking {
        responseStatusCode.set(401)
        responseBody = """{"error": "Unauthorized"}"""

        val provider = DefaultB2AuthorizationProvider(
            backendBaseUrl = "http://127.0.0.1:$serverPort"
        )

        try {
            provider.getUploadAuthorization(
                uid = "user1",
                objectKey = "backups/user1/src1/file.txt",
                sha256 = "abc123",
                sourceId = "src1",
                originalName = "file.txt",
                fileId = "1"
            )
            fail("Expected IOException on 401")
        } catch (e: IOException) {
            assertNotNull(e.message)
        }
    }

    @Test
    fun testUploadAuthorizationThrowsOnHttp403() = runBlocking {
        responseStatusCode.set(403)
        responseBody = """{"error": "Forbidden"}"""

        val provider = DefaultB2AuthorizationProvider(
            backendBaseUrl = "http://127.0.0.1:$serverPort"
        )

        try {
            provider.getUploadAuthorization(
                uid = "user1",
                objectKey = "backups/user1/src1/file.txt",
                sha256 = "abc123",
                sourceId = "src1",
                originalName = "file.txt",
                fileId = "1"
            )
            fail("Expected IOException on 403")
        } catch (e: IOException) {
            assertNotNull(e.message)
        }
    }

    @Test
    fun testUploadAuthorizationThrowsOnHttp429() = runBlocking {
        responseStatusCode.set(429)
        responseBody = """{"error": "Rate limit exceeded"}"""

        val provider = DefaultB2AuthorizationProvider(
            backendBaseUrl = "http://127.0.0.1:$serverPort"
        )

        try {
            provider.getUploadAuthorization(
                uid = "user1",
                objectKey = "backups/user1/src1/file.txt",
                sha256 = "abc123",
                sourceId = "src1",
                originalName = "file.txt",
                fileId = "1"
            )
            fail("Expected IOException on 429")
        } catch (e: IOException) {
            assertNotNull(e.message)
        }
    }

    @Test
    fun testUploadAuthorizationThrowsOnHttp500() = runBlocking {
        responseStatusCode.set(500)
        responseBody = """{"error": "Internal Server Error"}"""

        val provider = DefaultB2AuthorizationProvider(
            backendBaseUrl = "http://127.0.0.1:$serverPort"
        )

        try {
            provider.getUploadAuthorization(
                uid = "user1",
                objectKey = "backups/user1/src1/file.txt",
                sha256 = "abc123",
                sourceId = "src1",
                originalName = "file.txt",
                fileId = "1"
            )
            fail("Expected IOException on 500")
        } catch (e: IOException) {
            assertNotNull(e.message)
        }
    }

    @Test
    fun testHeadAndDeeleteAuthorizationThrowOnHttpError() = runBlocking {
        responseStatusCode.set(403)
        responseBody = """{"error": "Forbidden"}"""

        val provider = DefaultB2AuthorizationProvider(
            backendBaseUrl = "http://127.0.0.1:$serverPort"
        )

        try {
            provider.getHeadAuthorization(uid = "user1", objectKey = "backups/user1/src1/file.txt")
            fail("Expected IOException on head 403")
        } catch (e: IOException) {
            assertNotNull(e.message)
        }

        try {
            provider.getDeleteAuthorization(uid = "user1", objectKey = "backups/user1/src1/file.txt")
            fail("Expected IOException on delete 403")
        } catch (e: IOException) {
            assertNotNull(e.message)
        }
    }

    @Test
    fun testConnectionRefusedThrowsIOException() = runBlocking {
        val provider = DefaultB2AuthorizationProvider(
            backendBaseUrl = "http://127.0.0.1:1"
        )

        try {
            provider.getUploadAuthorization(
                uid = "user1",
                objectKey = "backups/user1/src1/file.txt",
                sha256 = "abc123",
                sourceId = "src1",
                originalName = "file.txt",
                fileId = "1"
            )
            fail("Expected IOException on connection failure")
        } catch (e: IOException) {
            assertNotNull(e.message)
        }
    }
}
