package com.usbcloudbackup.policy

import java.util.Locale

enum class BackupMode {
    AUTOMATIC,
    METADATA_ONLY
}

object BackupPolicyEngine {

    /**
     * System & OS directories that should never be traversed or backed up.
     * Evaluated case-insensitively.
     */
    val EXCLUDED_DIRECTORIES: Set<String> = setOf(
        "lost.dir",
        "system volume information",
        "\$recycle.bin",
        "recycler",
        ".spotlight-v100",
        ".fseventsd",
        ".temporaryitems",
        ".trashes"
    )

    /**
     * System directories that are excluded ONLY when present at the root of the USB volume.
     * Evaluated case-insensitively.
     * Android automatically creates /Android/ (data/obb/caches) upon mounting external storage.
     * User folders named "Android" inside subdirectories (e.g. "Projects/Android/") remain eligible.
     */
    val EXCLUDED_ROOT_DIRECTORIES: Set<String> = setOf(
        "android"
    )

    /**
     * Exact system/OS-generated metadata files that should be completely excluded.
     * Evaluated case-insensitively.
     */
    val EXCLUDED_FILE_NAMES: Set<String> = setOf(
        ".ds_store",
        "thumbs.db",
        "ehthumbs.db",
        "ehthumbs_vista.db",
        "desktop.ini",
        "folder.ini",
        ".nomedia",
        ".database_uuid"
    )

    /**
     * Prefix patterns for system/temporary lock files.
     * - "._" : AppleDouble resource forks created by macOS on FAT32/exFAT (e.g. ._photo.jpg)
     * - "~$" : Microsoft Office temporary lock files (e.g. ~$document.docx)
     */
    val EXCLUDED_FILE_PREFIXES: List<String> = listOf(
        "._",
        "~$"
    )

    /**
     * Checks if a directory should be excluded from traversal.
     */
    fun isExcludedDirectory(dirName: String, isRoot: Boolean): Boolean {
        val cleanName = dirName.trim().lowercase(Locale.ROOT)
        if (EXCLUDED_DIRECTORIES.contains(cleanName)) {
            return true
        }
        if (isRoot && EXCLUDED_ROOT_DIRECTORIES.contains(cleanName)) {
            return true
        }
        return false
    }

    /**
     * Checks if a file is an excluded system, OS, or temporary lock file.
     */
    fun isExcludedFile(fileName: String): Boolean {
        val cleanName = fileName.trim().lowercase(Locale.ROOT)
        if (EXCLUDED_FILE_NAMES.contains(cleanName)) {
            return true
        }
        for (prefix in EXCLUDED_FILE_PREFIXES) {
            if (cleanName.startsWith(prefix)) {
                return true
            }
        }
        return false
    }

    /**
     * Extracts extension without leading dot, lowercased.
     * e.g., "photo.JPG" -> "jpg", "archive.tar.gz" -> "gz", "README" -> ""
     */
    fun extractExtension(filename: String): String {
        val lastDot = filename.lastIndexOf('.')
        if (lastDot <= 0 || lastDot == filename.length - 1) return ""
        return filename.substring(lastDot + 1).lowercase(Locale.ROOT)
    }

    /**
     * Universal file eligibility policy:
     * ALL readable regular user files are eligible for AUTOMATIC byte upload.
     */
    fun classifyFile(filename: String): BackupMode {
        return BackupMode.AUTOMATIC
    }
}
