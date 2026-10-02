package com.usbcloudbackup.policy

import org.junit.Assert.assertEquals
import org.junit.Test

class BackupPolicyTest {

    @Test
    fun testUniversalAutomaticClassification() {
        val regularUserFiles = listOf(
            // Documents
            "doc.pdf", "file.doc", "notes.docx", "sheet.xls", "data.xlsx",
            "slides.ppt", "deck.pptx", "readme.txt", "export.csv", "letter.rtf",
            // Images
            "photo.jpg", "image.jpeg", "picture.png", "graphic.webp", "animation.gif",
            // Audio
            "song.mp3", "track.wav", "lossless.flac", "audio.m4a", "voice.aac", "clip.ogg",
            // Videos (Now AUTOMATIC)
            "video.mp4", "movie.mkv", "clip.avi", "recording.mov",
            // Archives & Packages (Now AUTOMATIC)
            "backup.zip", "archive.7z", "compressed.rar", "bundle.tar", "app.apk", "disk.iso",
            // Unknown extensions & binaries
            "binary.bin", "firmware.hex", "database.sqlite", "model.blend", "file.xyz123",
            // Extensionless files
            "README", "LICENSE", "Makefile", "Dockerfile"
        )
        for (name in regularUserFiles) {
            assertEquals("Expected $name to be AUTOMATIC", BackupMode.AUTOMATIC, BackupPolicyEngine.classifyFile(name))
        }
    }

    @Test
    fun testExcludedSystemFiles() {
        val excludedFiles = listOf(
            ".DS_Store",
            ".ds_store",
            "Thumbs.db",
            "thumbs.db",
            "ehthumbs.db",
            "ehthumbs_vista.db",
            "desktop.ini",
            "folder.ini",
            ".nomedia",
            ".database_uuid",
            ".DATABASE_UUID",
            ".Database_Uuid",
            // AppleDouble resource forks
            "._photo.jpg",
            "._HUMAN_EYE.pdf",
            "._clip.mp4",
            // Microsoft Office temporary locks
            "~\$notes.docx",
            "~\$budget.xlsx",
            "~\$slides.pptx"
        )
        for (name in excludedFiles) {
            assertEquals("Expected $name to be recognized as excluded file", true, BackupPolicyEngine.isExcludedFile(name))
        }

        val normalFiles = listOf(
            "test.mp4", "song.mp3", "archive.zip", "photo.jpg", "doc.pdf",
            "app.apk", "README", "notes.docx", "something.ds_store.txt",
            "database_uuid.txt", "my.database_uuid", "database_uuid.pdf", "database.sqlite"
        )
        for (name in normalFiles) {
            assertEquals("Expected $name to NOT be excluded", false, BackupPolicyEngine.isExcludedFile(name))
        }
    }

    @Test
    fun testExcludedSystemDirectories() {
        val universalExcludedDirs = listOf(
            "LOST.DIR",
            "lost.dir",
            "System Volume Information",
            "system volume information",
            "\$RECYCLE.BIN",
            "\$recycle.bin",
            "RECYCLER",
            "recycler",
            ".Spotlight-V100",
            ".fseventsd",
            ".TemporaryItems",
            ".Trashes"
        )
        for (dir in universalExcludedDirs) {
            assertEquals("Expected $dir to be excluded at root", true, BackupPolicyEngine.isExcludedDirectory(dir, isRoot = true))
            assertEquals("Expected $dir to be excluded in subfolder", true, BackupPolicyEngine.isExcludedDirectory(dir, isRoot = false))
        }

        // Root-level Android directory
        assertEquals("Expected root Android to be excluded", true, BackupPolicyEngine.isExcludedDirectory("Android", isRoot = true))
        assertEquals("Expected root android to be excluded", true, BackupPolicyEngine.isExcludedDirectory("android", isRoot = true))

        // Non-root Android directory (user created folder inside subfolder)
        assertEquals("Expected nested Android folder to NOT be excluded", false, BackupPolicyEngine.isExcludedDirectory("Android", isRoot = false))
        assertEquals("Expected nested android folder to NOT be excluded", false, BackupPolicyEngine.isExcludedDirectory("android", isRoot = false))

        // Normal user directories
        val normalDirs = listOf("School", "Notes", "Music", "Videos", "Images", "Personal", "Work")
        for (dir in normalDirs) {
            assertEquals("Expected $dir to NOT be excluded at root", false, BackupPolicyEngine.isExcludedDirectory(dir, isRoot = true))
            assertEquals("Expected $dir to NOT be excluded in subfolder", false, BackupPolicyEngine.isExcludedDirectory(dir, isRoot = false))
        }
    }

    @Test
    fun testExtractExtension() {
        assertEquals("pdf", BackupPolicyEngine.extractExtension("sample.pdf"))
        assertEquals("gz", BackupPolicyEngine.extractExtension("archive.tar.gz"))
        assertEquals("jpg", BackupPolicyEngine.extractExtension("IMAGE.JPG"))
        assertEquals("mp4", BackupPolicyEngine.extractExtension("video.MP4"))
        assertEquals("zip", BackupPolicyEngine.extractExtension("backup.zip"))
        assertEquals("", BackupPolicyEngine.extractExtension("README"))
        assertEquals("", BackupPolicyEngine.extractExtension("trailingdot."))
    }
}
