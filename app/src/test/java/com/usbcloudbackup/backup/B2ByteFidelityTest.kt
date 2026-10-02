package com.usbcloudbackup.backup

import com.usbcloudbackup.cloud.storage.b2.FakeB2StorageRepository
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.util.Random
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class B2ByteFidelityTest {

    private fun sha256(bytes: ByteArray): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }

    private fun generateSyntheticFixture(size: Int, seed: Long): ByteArray {
        val random = Random(seed)
        val data = ByteArray(size)
        random.nextBytes(data)
        return data
    }

    @Test
    fun testPdfFixtureByteFidelityInBackblazeB2() = runBlocking {
        verifyFixtureFidelity("lecture.pdf", 256 * 1024, 1001L)
    }

    @Test
    fun testPngFixtureByteFidelityInBackblazeB2() = runBlocking {
        verifyFixtureFidelity("photo.png", 512 * 1024, 2002L)
    }

    @Test
    fun testDocxFixtureByteFidelityInBackblazeB2() = runBlocking {
        verifyFixtureFidelity("thesis.docx", 128 * 1024, 3003L)
    }

    @Test
    fun testZipArchiveFixtureByteFidelityInBackblazeB2() = runBlocking {
        verifyFixtureFidelity("archive.zip", 1024 * 1024, 4004L)
    }

    @Test
    fun testMp3AudioFixtureByteFidelityInBackblazeB2() = runBlocking {
        verifyFixtureFidelity("track.mp3", 768 * 1024, 5005L)
    }

    private suspend fun verifyFixtureFidelity(filename: String, size: Int, seed: Long) {
        val sourceBytes = generateSyntheticFixture(size, seed)
        val sourceSha256 = sha256(sourceBytes)

        val repository = FakeB2StorageRepository()
        val cloudObjectPath = "backups/user_fidelity/src_fidelity/$filename"

        val metadata = mapOf(
            "x-amz-meta-sha256" to sourceSha256,
            "x-amz-meta-source-id" to "src_fidelity",
            "x-amz-meta-original-name" to filename,
            "x-amz-meta-file-id" to "1"
        )

        repository.uploadFileStream(
            cloudObjectPath = cloudObjectPath,
            inputStream = ByteArrayInputStream(sourceBytes),
            metadata = metadata
        )

        val storedBytes = repository.uploadedObjects[cloudObjectPath]
        val storedSha256 = sha256(storedBytes!!)

        assertEquals("Source SHA-256 and B2 Stored SHA-256 must match exactly for $filename", sourceSha256, storedSha256)
        assertArrayEquals("Source bytes and B2 stored bytes must be identical for $filename", sourceBytes, storedBytes)
    }
}
