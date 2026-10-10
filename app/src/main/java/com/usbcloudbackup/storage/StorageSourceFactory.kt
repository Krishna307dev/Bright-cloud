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

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testProcMountsProvider: (() -> List<String>)? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testDirectoryListFilesOverride: ((File) -> Array<File>?)? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testOemStaticCandidatePaths: List<File>? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testOemWildcardRoots: List<File>? = null

        val STATIC_OEM_CANDIDATE_PATHS = listOf(
            "/storage/usbotg",
            "/storage/UsbDiskA",
            "/storage/UsbDiskB",
            "/storage/UsbDiskC",
            "/storage/UsbDiskD",
            "/storage/UsbDiskE",
            "/storage/UsbDiskF",
            "/storage/USB_DISK0",
            "/storage/USB_DISK1",
            "/storage/USB_DISK2",
            "/storage/udisk",
            "/storage/udisk0",
            "/storage/udisk1",
            "/storage/USB",
            "/storage/usb",
            "/mnt/media_rw/usbotg",
            "/mnt/media_rw/sda1",
            "/mnt/media_rw/sda2",
            "/mnt/media_rw/sdb1",
            "/mnt/media_rw/sdb2",
            "/mnt/media_rw/USB_DISK0",
            "/mnt/media_rw/USB_DISK1"
        )

        val WILDCARD_OEM_ROOTS = listOf(
            "/mnt/usb_storage",
            "/mnt/udisk",
            "/udisk",
            "/mnt/usb",
            "/mnt/usbhost",
            "/mnt/media_rw"
        )

        val REMOVABLE_FS_TYPES = setOf(
            "vfat", "exfat", "ntfs", "fuseblk", "sdfat", "iso9660", "udf", "texfat"
        )

        val VOLUME_UUID_REGEX = Regex("""(?i)(?:[^0-9a-z]|^)([0-9a-f]{4}-[0-9a-f]{4}|[0-9a-f]{16})(?:[^0-9a-z]|$)""")

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testStoragePermissionOverride: Boolean? = null

        fun hasStoragePermission(context: Context): Boolean {
            testStoragePermissionOverride?.let { return it }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try {
                    if (Environment.isExternalStorageManager()) return true
                } catch (_: Throwable) {}
            }
            return try {
                androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    android.Manifest.permission.READ_EXTERNAL_STORAGE
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            } catch (_: Throwable) {
                false
            }
        }
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
        val hasPermission = hasStoragePermission(context)

        // 3. Direct File Mode with MANAGE_EXTERNAL_STORAGE, READ_EXTERNAL_STORAGE, or directFileMode pref
        if (hasPermission || isDirectFileMode) {
            val resolvedDirectory = resolveMountedVolumeDirectory(sourceId)
            if (resolvedDirectory != null && resolvedDirectory.exists() && resolvedDirectory.isDirectory && resolvedDirectory.canRead()) {
                Log.i(TAG, "Resolved real mounted USB directory: ${resolvedDirectory.absolutePath} for sourceId=$sourceId (hasPermission=$hasPermission, prefDirect=$isDirectFileMode)")
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

    data class CandidateProbeResult(
        val candidate: File,
        val exists: Boolean,
        val isDirectory: Boolean,
        val canRead: Boolean,
        val files: Array<File>?
    ) {
        val isEnumerationFailure: Boolean get() = exists && isDirectory && files == null
        val isValidEmpty: Boolean get() = exists && isDirectory && canRead && files != null && files.isEmpty()
        val isSuccessfulWithEntries: Boolean get() = exists && isDirectory && canRead && files != null && files.isNotEmpty()
    }

    private fun probeCandidate(candidate: File, stage: String): CandidateProbeResult {
        val exists = try { candidate.exists() } catch (_: Throwable) { false }
        val isDir = try { candidate.isDirectory } catch (_: Throwable) { false }
        val canRead = try { candidate.canRead() } catch (_: Throwable) { false }
        val files = if (exists && isDir) {
            if (testDirectoryListFilesOverride != null) {
                testDirectoryListFilesOverride?.invoke(candidate)
            } else {
                try { candidate.listFiles() } catch (_: Throwable) { null }
            }
        } else {
            null
        }

        val resultStr = when {
            !exists -> "does not exist"
            !isDir -> "not a directory"
            !canRead -> "not readable (canRead == false)"
            files == null -> "listFiles() == null (enumeration failure)"
            files.isEmpty() -> "listFiles() != null && empty (valid empty directory)"
            else -> "listFiles() != null && contains ${files.size} entries (successful storage root)"
        }
        Log.i(TAG, "[$stage] Candidate Probe: ${candidate.absolutePath} -> exists=$exists, isDirectory=$isDir, canRead=$canRead, result=$resultStr")

        return CandidateProbeResult(candidate, exists, isDir, canRead, files)
    }

    private fun resolveMountedVolumeDirectory(sourceId: String): File? {
        val volumeUuid = extractVolumeUuidFromSourceId(sourceId)
        var firstValidEmptyCandidate: File? = null
        val seenPaths = mutableSetOf<String>()

        fun evaluateCandidateList(candidates: List<File>, stage: String): File? {
            for (candidate in candidates) {
                val normalizedPath = candidate.absolutePath
                if (!seenPaths.add(normalizedPath)) continue

                val probe = probeCandidate(candidate, stage)
                if (probe.isSuccessfulWithEntries) {
                    Log.i(TAG, "[$stage] Selected successful storage root with entries: $normalizedPath")
                    return candidate
                } else if (probe.isValidEmpty && firstValidEmptyCandidate == null && stage != "Strategy 3: OEM Fallback") {
                    if (isMountedFileSystem(candidate, volumeUuid)) {
                        Log.i(TAG, "[$stage] Candidate $normalizedPath is a verified mounted empty directory.")
                        firstValidEmptyCandidate = candidate
                    } else {
                        Log.d(TAG, "[$stage] Skipping empty candidate $normalizedPath (mounted=false)")
                    }
                } else if (probe.isEnumerationFailure) {
                    Log.w(TAG, "[$stage] Enumeration failure on candidate $normalizedPath (listFiles == null). Continuing to next candidate.")
                }
            }
            return null
        }

        // -----------------------------------------------------------------------------------------
        // Strategy 1: Canonical StorageManager / StorageVolume.directory and /storage/$UUID path
        // -----------------------------------------------------------------------------------------
        val canonicalCandidates = mutableListOf<File>()

        // 1a. Test override provider directories (for unit test mocks)
        testMountedStorageDirectoriesProvider?.invoke(context)?.let { dirs ->
            canonicalCandidates.addAll(dirs)
        }

        // 1b. Direct exact match test (e.g. /storage/$sourceId)
        canonicalCandidates.add(File("/storage/$sourceId"))

        if (!volumeUuid.isNullOrBlank()) {
            canonicalCandidates.add(File("/storage/$volumeUuid"))
            canonicalCandidates.add(File("/mnt/media_rw/$volumeUuid"))
        }

        // 1c. Android Framework getExternalFilesDirs root extraction
        if (testStorageVolumesProvider == null && testMountedStorageDirectoriesProvider == null) {
            try {
                val externalDirs = mutableListOf<File?>()
                externalDirs.addAll(context.getExternalFilesDirs(null))
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    @Suppress("DEPRECATION")
                    externalDirs.addAll(context.externalMediaDirs)
                }
                for (dir in externalDirs.filterNotNull()) {
                    val path = dir.absolutePath
                    if (!path.startsWith("/storage/emulated") && !path.startsWith("/data/")) {
                        var current: File? = dir
                        var reachedStorageRoot = false
                        while (current != null && current.parentFile != null) {
                            val parent = current.parentFile?.absolutePath
                            if (parent == "/storage" || parent == "/mnt" || parent == "/mnt/media_rw") {
                                reachedStorageRoot = true
                                break
                            }
                            current = current.parentFile
                        }
                        if (reachedStorageRoot && current != null && current.exists() && current.isDirectory) {
                            if (volumeUuid == null || current.name.equals(volumeUuid, ignoreCase = true) || sourceId.contains(current.name, ignoreCase = true)) {
                                canonicalCandidates.add(current)
                            }
                        }
                    }
                }
            } catch (_: Throwable) {}
        }

        try {
            val volumes = testStorageVolumesProvider?.invoke(context) ?: run {
                val sm = context.getSystemService(StorageManager::class.java)
                sm?.storageVolumes ?: emptyList()
            }

            val removableVolumes = volumes.filter { it.isRemovable && !it.isPrimary }

            // Prioritize volume whose uuid or directory name matches sourceId or volumeUuid
            val prioritizedVolumes = removableVolumes.sortedByDescending { vol ->
                val uuid = vol.uuid
                val dirName = try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) vol.directory?.name else null
                } catch (t: Throwable) {
                    null
                }
                (uuid != null && (sourceId.contains(uuid, ignoreCase = true) || (volumeUuid != null && uuid.equals(volumeUuid, ignoreCase = true)))) ||
                (dirName != null && (sourceId.contains(dirName, ignoreCase = true) || (volumeUuid != null && dirName.equals(volumeUuid, ignoreCase = true))))
            }

            for (volume in prioritizedVolumes) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try { volume.directory } catch (_: Throwable) { null }?.let { canonicalCandidates.add(it) }
                }
                val uuid = volume.uuid
                if (!uuid.isNullOrBlank()) {
                    canonicalCandidates.add(File("/storage/$uuid"))
                    canonicalCandidates.add(File("/mnt/media_rw/$uuid"))
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "StorageManager query failed in Strategy 1: ${e.message}")
        }

        // Direct directory inspection under /storage
        try {
            val storageRoot = File("/storage")
            if (storageRoot.exists() && storageRoot.isDirectory) {
                val children = storageRoot.listFiles()?.filter { f ->
                    f.isDirectory && f.canRead() &&
                    f.name != "emulated" && f.name != "self" && f.name != "knox-emulated" && f.name != "sdcard0"
                } ?: emptyList()
                canonicalCandidates.addAll(children)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Directory inspection under /storage failed in Strategy 1: ${e.message}")
        }

        evaluateCandidateList(canonicalCandidates, "Strategy 1: Canonical")?.let { return it }

        // -----------------------------------------------------------------------------------------
        // Strategy 2: Dynamically inspect mounted filesystem table (/proc/mounts)
        // -----------------------------------------------------------------------------------------
        val dynamicMountCandidates = discoverMountsFromProcMounts(volumeUuid)
        evaluateCandidateList(dynamicMountCandidates, "Strategy 2: /proc/mounts")?.let { return it }

        // -----------------------------------------------------------------------------------------
        // Strategy 3: Bounded OEM Candidate Fallback List (Static + Wildcard roots)
        // -----------------------------------------------------------------------------------------
        val oemCandidates = discoverOemCandidates(volumeUuid)
        evaluateCandidateList(oemCandidates, "Strategy 3: OEM Fallback")?.let { return it }

        // If no candidate with entries was found, but a valid empty candidate exists, accept it
        if (firstValidEmptyCandidate != null) {
            Log.i(TAG, "Selected valid empty directory as storage root: ${firstValidEmptyCandidate.absolutePath}")
            return firstValidEmptyCandidate
        }

        Log.w(TAG, "All candidate probes failed enumeration or were unavailable for sourceId=$sourceId")
        return null
    }

    private fun discoverMountsFromProcMounts(volumeUuid: String?): List<File> {
        val lines = testProcMountsProvider?.invoke() ?: readProcMounts()
        if (lines.isEmpty()) return emptyList()

        val matchingCandidates = mutableListOf<File>()
        val genericRemovableCandidates = mutableListOf<File>()

        for (line in lines) {
            val tokens = line.trim().split(Regex("""\s+"""))
            if (tokens.size < 3) continue

            val device = tokens[0]
            val mountPoint = tokens[1]
            val fsType = tokens[2].lowercase(Locale.ROOT)

            // Reject virtual, loop, ram, and dm block devices
            if (device.startsWith("/dev/block/loop") ||
                device.startsWith("/dev/loop") ||
                device.contains("loop") ||
                device.startsWith("/dev/block/ram") ||
                device.startsWith("/dev/block/dm-") ||
                device == "none" ||
                device == "tmpfs" ||
                device == "rootfs"
            ) {
                continue
            }

            if (isSystemOrInternalMount(mountPoint)) continue

            val isRemovableFs = fsType in REMOVABLE_FS_TYPES
            val hasRemovableKeywords = mountPoint.contains("usb", ignoreCase = true) ||
                    mountPoint.contains("udisk", ignoreCase = true) ||
                    mountPoint.contains("media_rw", ignoreCase = true) ||
                    (volumeUuid != null && mountPoint.contains(volumeUuid, ignoreCase = true))

            if (!isRemovableFs && !hasRemovableKeywords) {
                continue
            }

            if (isUnrelatedVolumeMount(mountPoint, volumeUuid)) {
                Log.d(TAG, "Rejecting /proc/mounts entry $mountPoint: matches unrelated volume identity")
                continue
            }

            val file = File(mountPoint)
            if (volumeUuid != null && (mountPoint.contains(volumeUuid, ignoreCase = true) || device.contains(volumeUuid, ignoreCase = true))) {
                matchingCandidates.add(file)
            } else if (hasRemovableKeywords) {
                genericRemovableCandidates.add(file)
            }
        }

        return if (!volumeUuid.isNullOrBlank()) {
            matchingCandidates.ifEmpty { genericRemovableCandidates }
        } else {
            matchingCandidates + genericRemovableCandidates
        }
    }

    private fun readProcMounts(): List<String> {
        val file = File("/proc/mounts")
        return try {
            if (file.exists() && file.canRead()) {
                file.readLines()
            } else {
                emptyList()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Cannot read /proc/mounts: ${t.message}")
            emptyList()
        }
    }

    private fun isMountedFileSystem(candidate: File, targetVolumeUuid: String? = null): Boolean {
        if (testStorageVolumesProvider != null || testMountedStorageDirectoriesProvider != null || testRemovableDirectoryOverride != null) {
            return true
        }

        try {
            val sm = context.getSystemService(StorageManager::class.java)
            val volumes = sm?.storageVolumes ?: emptyList()
            for (volume in volumes) {
                if (volume.isRemovable && !volume.isPrimary) {
                    val state = try { volume.state } catch (_: Throwable) { null }
                    if (state == Environment.MEDIA_MOUNTED) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            val vDir = try { volume.directory } catch (_: Throwable) { null }
                            if (vDir != null && vDir.absolutePath == candidate.absolutePath) {
                                return true
                            }
                        }
                        val uuid = volume.uuid
                        if (!uuid.isNullOrBlank() && (candidate.name.equals(uuid, ignoreCase = true) || candidate.absolutePath.contains(uuid, ignoreCase = true))) {
                            return true
                        }
                    }
                }
            }
        } catch (_: Throwable) {}

        val mounts = testProcMountsProvider?.invoke() ?: readProcMounts()
        val path = candidate.absolutePath
        for (line in mounts) {
            val tokens = line.trim().split(Regex("""\s+"""))
            if (tokens.size >= 3) {
                val mountPoint = tokens[1]
                val fsType = tokens[2].lowercase(Locale.ROOT)
                if ((mountPoint == path || path.startsWith("$mountPoint/")) && (fsType in REMOVABLE_FS_TYPES || fsType == "fuse" || fsType == "sdcardfs")) {
                    return true
                }
            }
        }

        return false
    }

    private fun discoverOemCandidates(volumeUuid: String?): List<File> {
        val candidates = mutableListOf<File>()

        // 1. Static OEM candidate paths
        val staticPaths = testOemStaticCandidatePaths ?: STATIC_OEM_CANDIDATE_PATHS.map { File(it) }
        for (staticFile in staticPaths) {
            if (!isUnrelatedVolumeMount(staticFile.name, volumeUuid) && !isSystemOrInternalMount(staticFile.absolutePath)) {
                candidates.add(staticFile)
            }
        }

        // 2. Wildcard OEM roots (probe immediate children only)
        val wildcardRoots = testOemWildcardRoots ?: WILDCARD_OEM_ROOTS.map { File(it) }
        for (root in wildcardRoots) {
            try {
                if (root.exists() && root.isDirectory) {
                    val children = root.listFiles()?.filter { it.isDirectory } ?: emptyList()
                    for (child in children) {
                        val name = child.name
                        if (name == "." || name == "..") continue
                        if (name == "emulated" || name == "self" || name == "knox-emulated" || name == "sdcard0") continue
                        if (isUnrelatedVolumeMount(name, volumeUuid)) {
                            Log.d(TAG, "Rejecting wildcard child ${child.absolutePath}: matches unrelated volume identity")
                            continue
                        }
                        candidates.add(child)
                    }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "Error enumerating wildcard root ${root.absolutePath}: ${t.message}")
            }
        }

        // Prioritize candidates matching volumeUuid
        if (!volumeUuid.isNullOrBlank()) {
            return candidates.sortedByDescending { it.name.contains(volumeUuid, ignoreCase = true) || it.absolutePath.contains(volumeUuid, ignoreCase = true) }
        }

        return candidates
    }

    private fun isSystemOrInternalMount(mountPoint: String): Boolean {
        val clean = mountPoint.lowercase(Locale.ROOT)
        if (clean == "/" ||
            clean.startsWith("/system") ||
            clean.startsWith("/vendor") ||
            clean.startsWith("/product") ||
            clean.startsWith("/odm") ||
            clean.startsWith("/apex") ||
            clean.contains("/apex") ||
            clean.startsWith("/proc") ||
            clean.startsWith("/sys") ||
            clean.startsWith("/dev") ||
            clean.startsWith("/data") ||
            clean.startsWith("/cache") ||
            clean.startsWith("/config") ||
            clean.startsWith("/metadata") ||
            clean.startsWith("/storage/emulated") ||
            clean.startsWith("/storage/self") ||
            clean == "/sdcard" ||
            clean.startsWith("/sdcard/") ||
            clean.startsWith("/linkerconfig") ||
            clean.startsWith("/bionic") ||
            clean.startsWith("/bootstrap-apex")
        ) {
            return true
        }

        // For any /mnt/ path: reject unless explicitly an allowed removable root
        if (clean.startsWith("/mnt/")) {
            val isAllowedMnt = clean.startsWith("/mnt/media_rw") ||
                    clean.startsWith("/mnt/usb") ||
                    clean.startsWith("/mnt/udisk") ||
                    clean.startsWith("/mnt/usb_storage") ||
                    clean.startsWith("/mnt/usbhost")
            if (!isAllowedMnt) {
                return true
            }
        }

        return false
    }

    private fun isUnrelatedVolumeMount(nameOrPath: String, targetVolumeUuid: String?): Boolean {
        if (targetVolumeUuid.isNullOrBlank()) return false
        val targetClean = targetVolumeUuid.trim().uppercase(Locale.ROOT)

        val matches = VOLUME_UUID_REGEX.findAll(nameOrPath)
        for (match in matches) {
            val foundUuid = match.groupValues[1].uppercase(Locale.ROOT)
            if (foundUuid != targetClean) {
                return true
            }
        }
        return false
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
    private fun extractVolumeUuidFromSourceId(sourceId: String): String? =
        SourceIdResolver.extractVolumeUuidFromSourceId(sourceId)
}
