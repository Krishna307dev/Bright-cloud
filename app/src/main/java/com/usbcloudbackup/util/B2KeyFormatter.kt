package com.usbcloudbackup.util

object B2KeyFormatter {

    /**
     * Builds and validates a canonical Backblaze B2 object key:
     * backups/{uid}/{sourceId}/{relativePath}{storedName}
     */
    fun buildB2ObjectKey(
        uid: String,
        sourceId: String,
        relativePath: String,
        storedName: String
    ): String {
        require(uid.isNotBlank()) { "UID cannot be blank" }
        require(sourceId.isNotBlank()) { "sourceId cannot be blank" }
        require(storedName.isNotBlank()) { "storedName cannot be blank" }

        val cleanUid = sanitizeComponent(uid)
        val cleanSourceId = sanitizeComponent(sourceId)
        val cleanStoredName = sanitizeFilename(storedName)
        val cleanRelativePath = sanitizeRelativePath(relativePath)

        val prefix = if (cleanRelativePath.isEmpty()) "" else "$cleanRelativePath/"
        val key = "backups/$cleanUid/$cleanSourceId/$prefix$cleanStoredName"

        // Verify key is strictly under owner's prefix and contains no path traversal
        val expectedPrefix = "backups/$cleanUid/"
        require(key.startsWith(expectedPrefix)) {
            "B2 object key must strictly start with owner prefix: $expectedPrefix"
        }
        require(!key.contains("..")) {
            "B2 object key must not contain path traversal elements"
        }

        return key
    }

    private fun sanitizeComponent(component: String): String {
        return component
            .replace("\u0000", "")
            .replace("..", "_")
            .replace("/", "_")
            .replace("\\", "_")
            .trim()
    }

    private fun sanitizeFilename(name: String): String {
        return name
            .replace("\u0000", "")
            .replace("..", "_")
            .replace("/", "_")
            .replace("\\", "_")
            .trim()
    }

    private fun sanitizeRelativePath(path: String): String {
        if (path.isBlank()) return ""

        val cleaned = path
            .replace("\u0000", "")
            .replace("\\", "/")
            .trim()

        val segments = cleaned.split("/")
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "." }

        val safeSegments = mutableListOf<String>()
        for (seg in segments) {
            if (seg == "..") {
                if (safeSegments.isNotEmpty()) {
                    safeSegments.removeAt(safeSegments.size - 1)
                }
            } else {
                safeSegments.add(seg)
            }
        }

        return safeSegments.joinToString("/")
    }
}
