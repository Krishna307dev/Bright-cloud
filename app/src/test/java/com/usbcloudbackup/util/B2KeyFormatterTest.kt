package com.usbcloudbackup.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class B2KeyFormatterTest {

    @Test
    fun testNormalPath() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user123",
            sourceId = "1234-5678",
            relativePath = "Notes/Math/",
            storedName = "homework.docx"
        )
        assertEquals("backups/user123/1234-5678/Notes/Math/homework.docx", key)
    }

    @Test
    fun testRootLevelFile() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user123",
            sourceId = "1234-5678",
            relativePath = "",
            storedName = "README.txt"
        )
        assertEquals("backups/user123/1234-5678/README.txt", key)
    }

    @Test
    fun testUnicodeAndSpaces() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user123",
            sourceId = "1234-5678",
            relativePath = "Photos/Vacation 2026/Tokyo 東京/",
            storedName = "Mount Fuji 富士山.jpg"
        )
        assertEquals("backups/user123/1234-5678/Photos/Vacation 2026/Tokyo 東京/Mount Fuji 富士山.jpg", key)
    }

    @Test
    fun testNestedDirectories() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user123",
            sourceId = "1234-5678",
            relativePath = "a/b/c/d/e/f/",
            storedName = "data.csv"
        )
        assertEquals("backups/user123/1234-5678/a/b/c/d/e/f/data.csv", key)
    }

    @Test
    fun testExtensionlessFile() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user123",
            sourceId = "1234-5678",
            relativePath = "bin/",
            storedName = "LICENSE"
        )
        assertEquals("backups/user123/1234-5678/bin/LICENSE", key)
    }

    @Test
    fun testMultiDotFilename() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user123",
            sourceId = "1234-5678",
            relativePath = "archives/",
            storedName = "backup.2026.08.tar.gz"
        )
        assertEquals("backups/user123/1234-5678/archives/backup.2026.08.tar.gz", key)
    }

    @Test
    fun testVersionedFilename() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user123",
            sourceId = "1234-5678",
            relativePath = "docs/",
            storedName = "report(1).pdf"
        )
        assertEquals("backups/user123/1234-5678/docs/report(1).pdf", key)
    }

    @Test
    fun testPathTraversalRejectionAndSanitization() {
        val key = B2KeyFormatter.buildB2ObjectKey(
            uid = "user123",
            sourceId = "1234-5678",
            relativePath = "../../../etc/passwd",
            storedName = "shadow"
        )
        assertTrue(key.startsWith("backups/user123/1234-5678/"))
    }

    @Test
    fun testBlankUidThrows() {
        assertThrows(IllegalArgumentException::class.java) {
            B2KeyFormatter.buildB2ObjectKey(
                uid = "   ",
                sourceId = "1234-5678",
                relativePath = "",
                storedName = "file.txt"
            )
        }
    }
}
