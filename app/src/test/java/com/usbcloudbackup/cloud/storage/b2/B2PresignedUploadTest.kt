package com.usbcloudbackup.cloud.storage.b2

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class B2PresignedUploadTest {

    @Test
    fun testB2UploadAuthorizationGeneration() = runBlocking {
        val provider = FakeB2AuthorizationProvider()
        val auth = provider.getUploadAuthorization(
            uid = "user_abc",
            objectKey = "backups/user_abc/source_1/doc.pdf",
            sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            sourceId = "source_1",
            originalName = "doc.pdf",
            fileId = "123"
        )

        assertNotNull(auth.uploadUrl)
        assertTrue(auth.uploadUrl.startsWith("https://s3.eu-central-003.backblazeb2.com/BrightCloud/"))
        assertTrue(auth.uploadUrl.contains("X-Amz-Signature="))
        assertTrue(auth.expiresAt > System.currentTimeMillis())
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", auth.headers["x-amz-meta-sha256"])
        assertEquals("source_1", auth.headers["x-amz-meta-source-id"])
        assertEquals("doc.pdf", auth.headers["x-amz-meta-original-name"])
        assertEquals("123", auth.headers["x-amz-meta-file-id"])
    }

    @Test
    fun testB2HeadAuthorizationGeneration() = runBlocking {
        val provider = FakeB2AuthorizationProvider()
        val headAuth = provider.getHeadAuthorization(
            uid = "user_abc",
            objectKey = "backups/user_abc/source_1/doc.pdf"
        )

        assertNotNull(headAuth.headUrl)
        assertTrue(headAuth.headUrl.startsWith("https://s3.eu-central-003.backblazeb2.com/BrightCloud/"))
        assertTrue(headAuth.headUrl.contains("X-Amz-Signature="))
        assertTrue(headAuth.expiresAt > System.currentTimeMillis())
    }
}
