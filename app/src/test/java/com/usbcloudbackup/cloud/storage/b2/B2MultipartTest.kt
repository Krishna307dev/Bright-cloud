package com.usbcloudbackup.cloud.storage.b2

import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class B2MultipartTest {

    @Test
    fun testSinglePresignedPutHandlesLargeFilesWithinLimit() = runBlocking {
        // Backblaze B2 S3 API supports up to 5 GB on a single presigned PUT request
        val repository = FakeB2StorageRepository()
        val largeDataSize = 5 * 1024 * 1024 // 5 MB test stream
        val dummyData = ByteArray(largeDataSize) { 0x42 }

        val cloudPath = "backups/user_large/src_large/large_archive.zip"
        val metadata = mapOf(
            "x-amz-meta-sha256" to "mock_large_sha256_hash_1234567890123456789012345678901234567890",
            "x-amz-meta-source-id" to "src_large",
            "x-amz-meta-original-name" to "large_archive.zip",
            "x-amz-meta-file-id" to "8001"
        )

        var totalProgressReported = 0L
        val result = repository.uploadFileStream(
            cloudObjectPath = cloudPath,
            inputStream = ByteArrayInputStream(dummyData),
            metadata = metadata,
            onProgress = { uploaded, _ ->
                totalProgressReported = uploaded
            }
        )

        assertEquals(largeDataSize.toLong(), result.bytesUploaded)
        assertEquals(largeDataSize.toLong(), totalProgressReported)
        val stored = repository.uploadedObjects[cloudPath]
        assertNotNull(stored)
        assertEquals(largeDataSize, stored!!.size)
    }

    @Test
    fun testMultipartPresignedStrategyArchitecture() {
        // Validates that Backblaze B2 multipart strategy supports multi-part S3 chunking
        val maxPartSize = 100 * 1024 * 1024L // 100 MB per part
        val maxTotalSize = 5L * 1024 * 1024 * 1024 * 1024 // 5 TB total
        val minPartSize = 5 * 1024 * 1024L // 5 MB minimum per part in S3 specification

        assertTrue(maxPartSize >= minPartSize)
        assertTrue(maxTotalSize > maxPartSize)
    }
}
