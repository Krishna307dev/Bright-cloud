package com.usbcloudbackup.hashing

import android.util.Log
import java.io.InputStream
import java.security.MessageDigest

object Sha256Calculator {
    private const val TAG = "Sha256Calculator"
    const val BUFFER_SIZE = 64 * 1024 // 64 KB bounded buffer

    /**
     * Calculates SHA-256 hash from an InputStream using streaming I/O with a bounded 64 KB buffer.
     * Returns 64-character lowercase hexadecimal string.
     */
    fun calculateHash(inputStream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(BUFFER_SIZE)

        inputStream.use { stream ->
            var bytesRead: Int
            while (stream.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }

        val hashBytes = digest.digest()
        return bytesToHex(hashBytes)
    }

    /**
     * Calculates SHA-256 from input stream and validates that total bytes hashed match expected size.
     */
    fun calculateHashWithLengthCheck(inputStream: InputStream, expectedSize: Long): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(BUFFER_SIZE)
        var totalRead = 0L

        inputStream.use { stream ->
            var bytesRead: Int
            while (stream.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
                totalRead += bytesRead
            }
        }

        if (expectedSize > 0 && totalRead != expectedSize) {
            Log.w(TAG, "File size changed during hashing: expected=$expectedSize, actual=$totalRead")
        }

        return bytesToHex(digest.digest())
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            sb.append(String.format("%02x", b.toInt() and 0xFF))
        }
        return sb.toString()
    }
}
