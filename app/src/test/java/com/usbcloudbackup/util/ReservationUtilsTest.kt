package com.usbcloudbackup.util

import org.junit.Assert.assertEquals
import org.junit.Test

class ReservationUtilsTest {

    @Test
    fun testSplitFilenameStandardExtension() {
        val (basename, ext) = ReservationUtils.splitFilename("CHAPTER_5.pdf")
        assertEquals("CHAPTER_5", basename)
        assertEquals(".pdf", ext)
    }

    @Test
    fun testSplitFilenameMultipleDots() {
        val (basename, ext) = ReservationUtils.splitFilename("archive.tar.gz")
        assertEquals("archive.tar", basename)
        assertEquals(".gz", ext)
    }

    @Test
    fun testSplitFilenameNoExtension() {
        val (basename, ext) = ReservationUtils.splitFilename("README")
        assertEquals("README", basename)
        assertEquals("", ext)
    }

    @Test
    fun testFormatStoredNameVersions() {
        assertEquals("CHAPTER_5.pdf", ReservationUtils.formatStoredName("CHAPTER_5.pdf", 0))
        assertEquals("CHAPTER_5(1).pdf", ReservationUtils.formatStoredName("CHAPTER_5.pdf", 1))
        assertEquals("CHAPTER_5(2).pdf", ReservationUtils.formatStoredName("CHAPTER_5.pdf", 2))
        assertEquals("README(1)", ReservationUtils.formatStoredName("README", 1))
        assertEquals("archive.tar(1).gz", ReservationUtils.formatStoredName("archive.tar.gz", 1))
    }

    @Test
    fun testEncodeReservationIdUrlSafe() {
        val resId = ReservationUtils.encodeReservationId(
            sourceId = "1234-5678-SN001",
            relativePath = "Notes/Math Homework/",
            storedName = "CHAPTER_5(1).pdf"
        )
        assertEquals("1234-5678-SN001_Notes_SLASH_Math_SPACE_Homework_CHAPTER_5(1).pdf", resId)
    }

    @Test
    fun testEncodeReservationIdRootPath() {
        val resId = ReservationUtils.encodeReservationId(
            sourceId = "1234-5678-SN001",
            relativePath = "",
            storedName = "README.txt"
        )
        assertEquals("1234-5678-SN001_README.txt", resId)
    }

    @Test
    fun testBuildB2ObjectKey() {
        val path = ReservationUtils.buildB2ObjectKey(
            vaultId = "default",
            sourceId = "1234-5678-SN001",
            relativePath = "Notes/Math/",
            storedName = "CHAPTER_5.pdf"
        )
        assertEquals("backups/default/1234-5678-SN001/Notes/Math/CHAPTER_5.pdf", path)
    }

    @Test
    fun testBuildB2ObjectKeyRoot() {
        val path = ReservationUtils.buildB2ObjectKey(
            vaultId = "default",
            sourceId = "1234-5678-SN001",
            relativePath = "",
            storedName = "README.txt"
        )
        assertEquals("backups/default/1234-5678-SN001/README.txt", path)
    }

    @Test
    fun testBuildB2ObjectKeySanitizesNullBytesAndTraversal() {
        val path = ReservationUtils.buildB2ObjectKey(
            vaultId = "default\u0000",
            sourceId = "1234-5678-SN001",
            relativePath = "Notes/../Subdir/",
            storedName = "doc\u0000.pdf"
        )
        assertEquals("backups/default/1234-5678-SN001/Subdir/doc.pdf", path)
    }
}
