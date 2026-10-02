package com.usbcloudbackup.cloud.storage.b2

import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class B2MetadataTest {

    @Test
    fun testB2MetadataPreservationInUpload() = runBlocking {
        val fakeRepo = FakeB2StorageRepository()
        val data = "Metadata test payload content".toByteArray(Charsets.UTF_8)

        val metadata = mapOf(
            "x-amz-meta-sha256" to "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff",
            "x-amz-meta-source-id" to "usb-sandisk-123",
            "x-amz-meta-original-name" to "Quarterly Report.xlsx",
            "x-amz-meta-file-id" to "9901"
        )

        val cloudPath = "backups/user_meta/usb-sandisk-123/Quarterly Report.xlsx"
        fakeRepo.uploadFileStream(
            cloudObjectPath = cloudPath,
            inputStream = ByteArrayInputStream(data),
            metadata = metadata
        )

        val retrievedMeta = fakeRepo.checkObjectExists(cloudPath)
        assertNotNull(retrievedMeta)
        assertEquals("11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff", retrievedMeta!!.sha256)
        assertEquals("usb-sandisk-123", retrievedMeta.sourceId)
        assertEquals("Quarterly Report.xlsx", retrievedMeta.originalName)
        assertEquals("9901", retrievedMeta.fileId)
        assertEquals(data.size.toLong(), retrievedMeta.size)
    }
}
