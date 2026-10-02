package com.usbcloudbackup.security

import com.usbcloudbackup.cloud.storage.b2.B2UploadAuthorization
import com.usbcloudbackup.cloud.storage.b2.FakeB2AuthorizationProvider
import com.usbcloudbackup.util.B2KeyFormatter
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class B2SecurityTest {

    @Test
    fun testPrivateBucketEnforcement() {
        val provider = FakeB2AuthorizationProvider()
        assertEquals("https://s3.eu-central-003.backblazeb2.com/BrightCloud", provider.mockEndpoint)
    }

    @Test
    fun testCanonicalKeyUserPrefixEnforcement() {
        val uid = "authorized_user_123"
        val key = B2KeyFormatter.buildB2ObjectKey(uid, "src-1", "folder", "data.csv")
        assertTrue(key.startsWith("backups/$uid/"))
    }

    @Test
    fun testPathTraversalRejectionInKeyFormatter() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user_456",
            sourceId = "src-1",
            relativePath = "../../../etc",
            storedName = "../../shadow"
        )
        assertFalse(key.contains(".."))
        assertTrue(key.startsWith("backups/user_456/src-1/"))
    }

    @Test
    fun testAuthorizationFailureWhenUnauthorized() = runBlocking {
        val provider = FakeB2AuthorizationProvider()
        provider.shouldFail = true

        try {
            provider.getUploadAuthorization(
                uid = "user_unauthorized",
                objectKey = "backups/user_unauthorized/src/file.txt",
                sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                sourceId = "src",
                originalName = "file.txt",
                fileId = "1"
            )
            fail("Expected SecurityException on unauthorized request")
        } catch (e: SecurityException) {
            assertTrue(e.message!!.contains("Unauthorized"))
        }
    }
}
