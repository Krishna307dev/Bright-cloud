package com.usbcloudbackup.storage

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.provider.DocumentsContract
import android.util.Log
import androidx.annotation.VisibleForTesting
import com.usbcloudbackup.setup.MainActivity
import java.io.File
import java.util.Locale

class StorageSourceFactory(private val context: Context) {

    companion object {
        private const val TAG = "StorageSourceFactory"

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testRemovableDirectoryOverride: File? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testStorageVolumesProvider: ((Context) -> List<StorageVolume>)?
            get() = SourceIdResolver.testStorageVolumesProvider
            set(value) { SourceIdResolver.testStorageVolumesProvider = value }

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testPersistedUriPermissionsProvider: ((Context) -> List<Uri>)? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testMountedStorageDirectoriesProvider: ((Context) -> List<File>)?
            get() = SourceIdResolver.testMountedStorageDirectoriesProvider
            set(value) { SourceIdResolver.testMountedStorageDirectoriesProvider = value }
    }

    fun createStorageSource(sourceId: String, customUri: Uri? = null): UsbStorageSource {
        // 1. Explicit custom URI provided
        if (customUri != null) {
            return SafStorageSource(sourceId, "USB Drive $sourceId", context, customUri)
        }

        // 2. Testing directory override
        testRemovableDirectoryOverride?.let { dir ->
            if (dir.exists() && dir.isDirectory && dir.canRead()) {
                return DirectFileStorageSource(sourceId, "USB Drive $sourceId", dir)
            }
        }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val isDirectFileMode = prefs.getBoolean(MainActivity.KEY_DIRECT_FILE_MODE, false)

        // Check if MANAGE_EXTERNAL_STORAGE is active (API 30+)
        val isExternalManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Environment.isExternalStorageManager()
            } catch (t: Throwable) {
                false
            }
        } else {
            false
        }

        // 3. Direct File Mode with MANAGE_EXTERNAL_STORAGE or test environment
        if (isDirectFileMode && isExternalManager) {
            val resolvedDirectory = resolveMountedVolumeDirectory(sourceId)
            if (resolvedDirectory != null && resolvedDirectory.exists() && resolvedDirectory.isDirectory && resolvedDirectory.canRead()) {
                Log.i(TAG, "Resolved real mounted USB directory: ${resolvedDirectory.absolutePath} for sourceId=$sourceId")
                return DirectFileStorageSource(sourceId, "USB Drive $sourceId", resolvedDirectory)
            }
        }

        // 4. SAF Persisted URI Resolution: STRICT PHYSICAL VOLUME IDENTITY MATCHING
        val persistedUris = getPersistedUris()
        val matchingUri = persistedUris.firstOrNull { uri ->
            isMatchingVolumeUri(sourceId, uri)
        }
        if (matchingUri != null) {
            Log.i(TAG, "Using SAF storage source with exact matching URI: $matchingUri for sourceId=$sourceId")
            return SafStorageSource(sourceId, "USB Drive $sourceId", context, matchingUri)
        }

        // 5. Fallback: try checking if a mounted removable directory exists for this specific sourceId
        val fallbackDir = resolveMountedVolumeDirectory(sourceId)
        if (fallbackDir != null && fallbackDir.exists() && fallbackDir.isDirectory && fallbackDir.canRead()) {
            return DirectFileStorageSource(sourceId, "USB Drive $sourceId", fallbackDir)
        }

        // If no matching URI and no readable directory, return an unavailable storage source for this sourceId
        return DirectFileStorageSource(sourceId, "USB Drive $sourceId", fallbackDir ?: File("/storage/$sourceId"))
    }

    private fun resolveMountedVolumeDirectory(sourceId: String): File? {
        // Direct exact match test (e.g. /storage/1234-5678-a1b2c3d4 or custom path)
        val directSourceDir = File("/storage/$sourceId")
        if (directSourceDir.exists() && directSourceDir.isDirectory && directSourceDir.canRead()) {
            return directSourceDir
        }

        // Query StorageManager (API 24+)
        try {
            val volumes = testStorageVolumesProvider?.invoke(context) ?: run {
                val sm = context.getSystemService(StorageManager::class.java)
                sm?.storageVolumes ?: emptyList()
            }

            val removableVolumes = volumes.filter { it.isRemovable && !it.isPrimary }

            // Prioritize volume whose uuid or directory name matches sourceId
            val prioritizedVolumes = removableVolumes.sortedByDescending { vol ->
                val uuid = vol.uuid
                val dirName = try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) vol.directory?.name else null
                } catch (t: Throwable) {
                    null
                }
                (uuid != null && sourceId.contains(uuid, ignoreCase = true)) || (dirName != null && sourceId.contains(dirName, ignoreCase = true))
            }

            for (volume in prioritizedVolumes) {
                // API 30+ has volume.directory (e.g. /storage/8F12-3456)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val dir = try {
                        volume.directory
                    } catch (t: Throwable) {
                        null
                    }
                    if (dir != null && dir.exists() && dir.isDirectory && dir.canRead()) {
                        return dir
                    }
                }

                // API 24+ has volume.uuid (e.g. "8F12-3456")
                val uuid = volume.uuid
                if (!uuid.isNullOrBlank()) {
                    val candidate = File("/storage/$uuid")
                    if (candidate.exists() && candidate.isDirectory && candidate.canRead()) {
                        return candidate
                    }
                    val mntCandidate = File("/mnt/media_rw/$uuid")
                    if (mntCandidate.exists() && mntCandidate.isDirectory && mntCandidate.canRead()) {
                        return mntCandidate
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "StorageManager query failed: ${e.message}")
        }

        // Test/custom provider or directory inspection under /storage
        try {
            val candidateDirs = testMountedStorageDirectoriesProvider?.invoke(context) ?: run {
                val storageRoot = File("/storage")
                if (storageRoot.exists() && storageRoot.isDirectory && storageRoot.canRead()) {
                    storageRoot.listFiles()?.filter { f ->
                        f.isDirectory && f.canRead() &&
                        f.name != "emulated" && f.name != "self" && f.name != "knox-emulated" && f.name != "sdcard0"
                    } ?: emptyList()
                } else {
                    emptyList()
                }
            }

            if (candidateDirs.isNotEmpty()) {
                val matching = candidateDirs.firstOrNull { f -> sourceId.contains(f.name, ignoreCase = true) }
                return matching ?: candidateDirs.first()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Directory inspection under /storage failed: ${e.message}")
        }

        return null
    }

    private fun getPersistedUris(): List<Uri> {
        testPersistedUriPermissionsProvider?.invoke(context)?.let { return it }
        return try {
            context.contentResolver.persistedUriPermissions?.map { it.uri } ?: emptyList()
        } catch (t: Throwable) {
            emptyList()
        }
    }

    /**
     * Strictly verifies that the SAF tree URI matches the physical volume UUID represented in canonical sourceId.
     * ZERO substring matching is performed. Only exact, case-insensitive string equality of the extracted
     * volume UUID is accepted.
     */
    private fun isMatchingVolumeUri(sourceId: String, uri: Uri): Boolean {
        val sourceVolumeUuid = extractVolumeUuidFromSourceId(sourceId) ?: return false
        val uriVolumeUuid = extractVolumeUuidFromTreeUri(uri) ?: return false
        return sourceVolumeUuid.equals(uriVolumeUuid, ignoreCase = true)
    }

    /**
     * Extracts the volume UUID component from a SAF tree URI.
     */
    private fun extractVolumeUuidFromTreeUri(uri: Uri): String? {
        return try {
            val docId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    DocumentsContract.getTreeDocumentId(uri)
                } catch (_: Throwable) {
                    null
                }
            } else null

            val rawId = docId ?: run {
                val decoded = Uri.decode(uri.toString())
                val treeSegment = decoded.substringAfter("/tree/", "").substringBefore('/')
                if (treeSegment.isNotEmpty()) treeSegment else null
            }

            if (!rawId.isNullOrBlank()) {
                val volumePart = rawId.substringBefore(':').trim()
                if (volumePart.isNotEmpty()) {
                    volumePart.uppercase(Locale.ROOT)
                } else null
            } else null
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * Extracts the volume UUID component from canonical sourceId.
     * - "1234-5678-8F12-3456" -> "8F12-3456"
     * - "VOL-8F12-3456" -> "8F12-3456"
     * - "8F12-3456" -> "8F12-3456"
     * - "SN-..." or "DEV-..." -> null (non-volume fallbacks)
     */
    private fun extractVolumeUuidFromSourceId(sourceId: String): String? {
        val clean = sourceId.trim().uppercase(Locale.ROOT)
        if (clean.startsWith("SN-") || clean.startsWith("DEV-")) {
            return null
        }
        if (clean.startsWith("VOL-")) {
            return clean.removePrefix("VOL-").trim().takeIf { it.isNotEmpty() }
        }
        val vidPidMatch = Regex("""^(\d+)-(\d+)-(.+)$""").matchEntire(clean)
        if (vidPidMatch != null) {
            val candidate = vidPidMatch.groupValues[3].trim()
            return candidate.takeIf { it.isNotEmpty() }
        }
        return clean.takeIf { it.isNotEmpty() }
    }
}
