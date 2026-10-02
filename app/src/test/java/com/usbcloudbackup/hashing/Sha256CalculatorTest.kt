package com.usbcloudbackup.hashing

import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Test

class Sha256CalculatorTest {

    @Test
    fun testEmptyInputHash() {
        val stream = ByteArrayInputStream(ByteArray(0))
        val hash = Sha256Calculator.calculateHash(stream)
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", hash)
    }

    @Test
    fun testAbcInputHash() {
        val stream = ByteArrayInputStream("abc".toByteArray(Charsets.UTF_8))
        val hash = Sha256Calculator.calculateHash(stream)
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hash)
    }

    @Test
    fun testLargeGeneratedFileStreamingHash() {
        val tempFile = File.createTempFile("large_test_", ".bin")
        tempFile.deleteOnExit()

        // Generate 500 KB pattern data
        val chunkSize = 64 * 1024
        val numChunks = 8
        FileOutputStream(tempFile).use { fos ->
            val pattern = ByteArray(chunkSize) { (it % 256).toByte() }
            for (i in 0 until numChunks) {
                fos.write(pattern)
            }
        }

        val streamingHash = FileInputStream(tempFile).use { Sha256Calculator.calculateHash(it) }

        // Standard single-shot MessageDigest calculation for comparison
        val digest = MessageDigest.getInstance("SHA-256")
        val expectedBytes = digest.digest(tempFile.readBytes())
        val expectedHash = expectedBytes.joinToString("") { "%02x".format(it) }

        assertEquals(expectedHash, streamingHash)
    }

    @Test(expected = IOException::class)
    fun testIoExceptionPropagation() {
        val failingStream = object : InputStream() {
            override fun read(): Int {
                throw IOException("Simulated disk read failure")
            }
        }
        Sha256Calculator.calculateHash(failingStream)
    }
}
