package com.usbcloudbackup.fidelity

import com.usbcloudbackup.cloud.storage.b2.FakeB2StorageRepository
import com.usbcloudbackup.hashing.Sha256Calculator
import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class ByteFidelityTest {

    private val fakeB2 = FakeB2StorageRepository()

    @Test
    fun testPdfByteFidelity() = runBlocking {
        // PDF fixture header + body + EOF marker
        val pdfBytes = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\ntrailer\n<< /Root 1 0 R >>\n%%EOF".toByteArray(Charsets.ISO_8859_1)
        verifyFidelity("backups/user1/src1/doc.pdf", pdfBytes)
    }

    @Test
    fun testPngByteFidelity() = runBlocking {
        // PNG 8-byte magic header + IHDR + IDAT + IEND
        val pngBytes = byteArrayOf(
            0x89.toByte(), 0x50.toByte(), 0x4E.toByte(), 0x47.toByte(),
            0x0D.toByte(), 0x0A.toByte(), 0x1A.toByte(), 0x0A.toByte(),
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4.toByte(), 0x89.toByte(),
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE.toByte(), 0x42, 0x60, 0x82.toByte() // IEND
        )
        verifyFidelity("backups/user1/src1/image.png", pngBytes)
    }

    @Test
    fun testJpegByteFidelity() = runBlocking {
        // JPEG SOI (FF D8) + APP0 + EOI (FF D9)
        val jpegBytes = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(),
            0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
            0xFF.toByte(), 0xD9.toByte()
        )
        verifyFidelity("backups/user1/src1/photo.jpg", jpegBytes)
    }

    @Test
    fun testDocxByteFidelity() = runBlocking {
        // ZIP/DOCX PK 03 04 signature + XML stream
        val docxBytes = byteArrayOf(
            0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00
        ) + "[Content_Types].xml\nword/document.xml".toByteArray()
        verifyFidelity("backups/user1/src1/document.docx", docxBytes)
    }

    @Test
    fun testMp3ByteFidelity() = runBlocking {
        // MP3 ID3 header + frame sync FF FB
        val mp3Bytes = byteArrayOf(
            0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0xFF.toByte(), 0xFB.toByte(), 0x90.toByte(), 0x44.toByte()
        )
        verifyFidelity("backups/user1/src1/audio.mp3", mp3Bytes)
    }

    @Test
    fun testZipByteFidelity() = runBlocking {
        // Standard ZIP archive PK 03 04
        val zipBytes = byteArrayOf(
            0x50, 0x4B, 0x03, 0x04, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00
        ) + "archive_test_contents".toByteArray()
        verifyFidelity("backups/user1/src1/archive.zip", zipBytes)
    }

    private suspend fun verifyFidelity(cloudPath: String, sourceBytes: ByteArray) {
        val sourceSha256 = Sha256Calculator.calculateHash(ByteArrayInputStream(sourceBytes))

        fakeB2.uploadFileStream(
            cloudObjectPath = cloudPath,
            inputStream = ByteArrayInputStream(sourceBytes),
            metadata = mapOf("x-amz-meta-sha256" to sourceSha256)
        )

        val storedBytes = fakeB2.getStoredBytes(cloudPath)
        assertNotNull("Stored bytes must not be null for $cloudPath", storedBytes)
        assertArrayEquals("Stored bytes must match source bytes byte-for-byte", sourceBytes, storedBytes)

        val storedSha256 = Sha256Calculator.calculateHash(ByteArrayInputStream(storedBytes!!))
        assertEquals("Stored SHA-256 must match source SHA-256", sourceSha256, storedSha256)
    }
}
