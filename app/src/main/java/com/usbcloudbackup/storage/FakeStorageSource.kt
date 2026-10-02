package com.usbcloudbackup.storage

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

open class FakeStorageSource(
    override val sourceId: String = "fake-source-001",
    override val displayName: String = "Fake USB Drive",
    private var available: Boolean = true
) : UsbStorageSource {

    data class FakeFileEntry(
        val relativePath: String,
        val originalName: String,
        val content: ByteArray,
        val lastModified: Long = System.currentTimeMillis(),
        val shouldFailOnOpen: Boolean = false
    )

    private val entries = mutableListOf<FakeFileEntry>()
    var detachOnSecondOpen: Boolean = false
    private var openCount = 0

    fun addFile(
        relativePath: String,
        originalName: String,
        content: ByteArray,
        lastModified: Long = System.currentTimeMillis(),
        shouldFailOnOpen: Boolean = false
    ) {
        entries.removeAll { it.relativePath == relativePath && it.originalName == originalName }
        entries.add(
            FakeFileEntry(
                relativePath = relativePath,
                originalName = originalName,
                content = content,
                lastModified = lastModified,
                shouldFailOnOpen = shouldFailOnOpen
            )
        )
    }

    fun setAvailable(isAvailable: Boolean) {
        this.available = isAvailable
    }

    open override suspend fun isAvailable(): Boolean = available

    override suspend fun discoverFiles(): List<DiscoveredFileDescriptor> {
        if (!available) {
            throw IOException("Fake USB source is unavailable")
        }
        return entries.filter { entry ->
            val dirParts = entry.relativePath.split("/").filter { it.isNotEmpty() }
            val inExcludedDir = dirParts.isNotEmpty() && (
                com.usbcloudbackup.policy.BackupPolicyEngine.isExcludedDirectory(dirParts[0], isRoot = true) ||
                dirParts.drop(1).any { com.usbcloudbackup.policy.BackupPolicyEngine.isExcludedDirectory(it, isRoot = false) }
            )
            !inExcludedDir && !com.usbcloudbackup.policy.BackupPolicyEngine.isExcludedFile(entry.originalName)
        }.map { entry ->
            DiscoveredFileDescriptor(
                relativePath = entry.relativePath,
                originalName = entry.originalName,
                size = entry.content.size.toLong(),
                lastModified = entry.lastModified,
                openInputStream = {
                    if (entry.shouldFailOnOpen) {
                        throw IOException("File disappeared or unreadable: ${entry.originalName}")
                    }
                    if (detachOnSecondOpen && ++openCount >= 2) {
                        available = false
                        throw IOException("USB detached during file transfer")
                    }
                    ByteArrayInputStream(entry.content)
                }
            )
        }
    }
}
