package com.usbcloudbackup.storage

import android.util.Log
import androidx.annotation.VisibleForTesting
import com.usbcloudbackup.policy.BackupPolicyEngine
import java.io.File
import java.io.FileInputStream
import java.io.IOException

class DirectFileStorageSource(
    override val sourceId: String,
    override val displayName: String,
    private val rootDirectory: File
) : UsbStorageSource {

    companion object {
        private const val TAG = "DirectFileStorageSource"

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testListFilesOverride: ((File) -> Array<File>?)? = null
    }

    override suspend fun isAvailable(): Boolean {
        if (!rootDirectory.exists() || !rootDirectory.isDirectory || !rootDirectory.canRead()) {
            return false
        }
        val files = if (testListFilesOverride != null) {
            testListFilesOverride?.invoke(rootDirectory)
        } else {
            try { rootDirectory.listFiles() } catch (_: Throwable) { null }
        }
        return files != null
    }

    override suspend fun discoverFiles(): List<DiscoveredFileDescriptor> {
        if (!isAvailable()) {
            throw IOException("USB storage root is unavailable or unreadable: ${rootDirectory.absolutePath}")
        }

        val descriptors = mutableListOf<DiscoveredFileDescriptor>()
        traverseDirectory(rootDirectory, "", descriptors)
        return descriptors
    }

    private fun traverseDirectory(currentDir: File, currentRelativePath: String, outList: MutableList<DiscoveredFileDescriptor>) {
        val files = if (testListFilesOverride != null) {
            testListFilesOverride?.invoke(currentDir)
        } else {
            try { currentDir.listFiles() } catch (e: Exception) { null }
        } ?: run {
            if (currentRelativePath.isEmpty()) {
                Log.e(TAG, "Enumeration failure: listFiles() returned null for storage root: ${currentDir.absolutePath}")
                throw IOException("Enumeration failure: listFiles() returned null for storage root: ${currentDir.absolutePath}")
            }
            Log.w(TAG, "Cannot list files in subdirectory: ${currentDir.absolutePath}")
            return
        }

        // Sort files for reproducible/deterministic traversal order
        val sortedFiles = files.sortedBy { it.name }
        val isRoot = currentRelativePath.isEmpty()

        for (file in sortedFiles) {
            if (!file.exists()) continue

            if (file.isDirectory) {
                if (BackupPolicyEngine.isExcludedDirectory(file.name, isRoot)) {
                    Log.d(TAG, "Skipping excluded system directory: ${file.name} (isRoot=$isRoot)")
                    continue
                }
                val nextRelativePath = if (isRoot) {
                    "${file.name}/"
                } else {
                    "$currentRelativePath${file.name}/"
                }
                traverseDirectory(file, nextRelativePath, outList)
            } else if (file.isFile) {
                if (!file.canRead()) {
                    Log.w(TAG, "Skipping unreadable file: ${file.absolutePath}")
                    continue
                }
                if (BackupPolicyEngine.isExcludedFile(file.name)) {
                    Log.d(TAG, "Skipping excluded system file: ${file.name}")
                    continue
                }
                try {
                    val descriptor = DiscoveredFileDescriptor(
                        relativePath = currentRelativePath,
                        originalName = file.name,
                        size = file.length(),
                        lastModified = file.lastModified(),
                        mimeType = null, // Will be resolved if needed
                        openInputStream = { FileInputStream(file) }
                    )
                    outList.add(descriptor)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed creating descriptor for file ${file.name}: ${e.message}")
                }
            }
        }
    }
}
