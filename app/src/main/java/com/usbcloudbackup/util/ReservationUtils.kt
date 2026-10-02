package com.usbcloudbackup.util

object ReservationUtils {

    /**
     * Splits filename into basename and extension.
     * Example: "document.pdf" -> Pair("document", ".pdf")
     * Example: "archive.tar.gz" -> Pair("archive.tar", ".gz")
     * Example: "README" -> Pair("README", "")
     */
    fun splitFilename(filename: String): Pair<String, String> {
        val lastDotIndex = filename.lastIndexOf('.')
        return if (lastDotIndex > 0) {
            val basename = filename.substring(0, lastDotIndex)
            val extension = filename.substring(lastDotIndex)
            Pair(basename, extension)
        } else {
            Pair(filename, "")
        }
    }

    /**
     * Formats stored filename for a given version.
     * Version 0 = original ("doc.pdf")
     * Version 1 = ("doc(1).pdf")
     * Version 2 = ("doc(2).pdf")
     */
    fun formatStoredName(originalName: String, version: Int): String {
        if (version == 0) return originalName
        val (basename, extension) = splitFilename(originalName)
        return "$basename($version)$extension"
    }

    /**
     * Extracts version number from storedName given originalName.
     * Example: ("HUMAN_EYE(1).pdf", "HUMAN_EYE.pdf") -> 1
     * Example: ("HUMAN_EYE.pdf", "HUMAN_EYE.pdf") -> 0
     */
    fun extractVersion(storedName: String, originalName: String): Int {
        if (storedName == originalName) return 0
        val (base, ext) = splitFilename(originalName)
        val pattern = Regex("^" + Regex.escape(base) + """\((\d+)\)""" + Regex.escape(ext) + "$")
        val match = pattern.find(storedName)
        return match?.groupValues?.get(1)?.toIntOrNull() ?: 0
    }

    /**
     * Computes deterministic, URL-safe reservation ID according to NAME_RESERVATION.md.
     * Format: {sourceId}_{relativePath}_{storedName}
     * URL-safe encoding: replace '/' with '_SLASH_', spaces with '_SPACE_'.
     */
    fun encodeReservationId(sourceId: String, relativePath: String, storedName: String): String {
        val cleanPath = relativePath.trim().trim('/')
        val combined = if (cleanPath.isEmpty()) {
            "${sourceId}_$storedName"
        } else {
            "${sourceId}_${cleanPath}_$storedName"
        }
        return combined
            .replace("/", "_SLASH_")
            .replace(" ", "_SPACE_")
    }

    /**
     * Computes full canonical Backblaze B2 object key according to B2_STORAGE_SCHEMA.md.
     * Format: backups/{vaultId}/{sourceId}/{relativePath}{storedName}
     */
    fun buildB2ObjectKey(vaultId: String, sourceId: String, relativePath: String, storedName: String): String {
        return B2KeyFormatter.buildB2ObjectKey(vaultId, sourceId, relativePath, storedName)
    }
}
