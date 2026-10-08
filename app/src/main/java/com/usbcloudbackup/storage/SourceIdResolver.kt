package com.usbcloudbackup.storage

import android.content.Context
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.util.Log
import androidx.annotation.VisibleForTesting
import java.io.File
import java.security.MessageDigest
import java.util.Locale

object SourceIdResolver {

    private const val TAG = "SourceIdResolver"

    @get:VisibleForTesting
    @set:VisibleForTesting
    var testStorageVolumesProvider: ((Context) -> List<StorageVolume>)? = null

    @get:VisibleForTesting
    @set:VisibleForTesting
    var testMountedStorageDirectoriesProvider: ((Context) -> List<File>)? = null

    /**
     * Resolves the canonical, deterministic sourceId for a physical USB storage drive.
     *
     * Hierarchy:
     * 1. Primary: Filesystem partition volume UUID (e.g. "FAC5-5D5E" from FAT32/exFAT).
     * 2. Supplemental: USB hardware VID/PID.
     * 3. Fallback: USB hardware serial number (if accessible) or deterministic SHA-256 hash.
     *
     * Invariants:
     * - SAME PHYSICAL DRIVE -> SAME sourceId
     * - Independent of: Android phone model, reboot, reinsertion, or Firebase Anonymous UID.
     */
    fun computeSourceId(
        volumeUuid: String?,
        vendorId: Int = 0,
        productId: Int = 0,
        serialNumber: String? = null,
        manufacturerName: String? = null,
        productName: String? = null
    ): String {
        val cleanUuid = volumeUuid?.trim()?.uppercase(Locale.ROOT)
        if (!cleanUuid.isNullOrEmpty() && cleanUuid != "NULL") {
            return if (vendorId > 0 && productId > 0) {
                "$vendorId-$productId-$cleanUuid"
            } else {
                "VOL-$cleanUuid"
            }
        }

        val cleanSerial = serialNumber?.trim()
        if (!cleanSerial.isNullOrEmpty() && cleanSerial != "null" && cleanSerial != "0") {
            return if (vendorId > 0 && productId > 0) {
                "$vendorId-$productId-$cleanSerial"
            } else {
                "SN-$cleanSerial"
            }
        }

        // Fallback: deterministic SHA-256 hash of manufacturer + product
        val raw = "${manufacturerName ?: ""}_${productName ?: ""}"
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        val fallbackHash = digest.joinToString("") { "%02x".format(it) }.take(8)
        return if (vendorId > 0 && productId > 0) {
            "$vendorId-$productId-$fallbackHash"
        } else {
            "DEV-$fallbackHash"
        }
    }

    fun computeSourceId(volumeUuid: String?, device: UsbDevice?): String {
        val cleanUuid = volumeUuid?.trim()?.uppercase(Locale.ROOT)
        val vid = device?.vendorId ?: 0
        val pid = device?.productId ?: 0

        // Primary: Volume UUID (e.g. "FAC5-5D5E")
        if (!cleanUuid.isNullOrEmpty() && cleanUuid != "NULL") {
            return if (vid > 0 && pid > 0) {
                "$vid-$pid-$cleanUuid"
            } else {
                "VOL-$cleanUuid"
            }
        }

        // Supplemental: USB serial number
        val serial = if (device != null) {
            try {
                device.serialNumber?.trim()
            } catch (_: SecurityException) {
                null
            } catch (_: Throwable) {
                null
            }
        } else null

        if (!serial.isNullOrEmpty() && serial != "null" && serial != "0") {
            return if (vid > 0 && pid > 0) {
                "$vid-$pid-$serial"
            } else {
                "SN-$serial"
            }
        }

        // Fallback: Manufacturer + Product hash
        val manufacturer = if (device != null) {
            try { device.manufacturerName } catch (_: Throwable) { null }
        } else null
        val product = if (device != null) {
            try { device.productName } catch (_: Throwable) { null }
        } else null

        return computeSourceId(
            volumeUuid = volumeUuid,
            vendorId = vid,
            productId = pid,
            serialNumber = serial,
            manufacturerName = manufacturer,
            productName = product
        )
    }

    private val canonicalToHardwareMap = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val hardwareToCanonicalMap = java.util.concurrent.ConcurrentHashMap<String, String>()

    @VisibleForTesting
    fun clearMappingsForTesting() {
        canonicalToHardwareMap.clear()
        hardwareToCanonicalMap.clear()
    }

    /**
     * Registers a bidirectional mapping between a physical hardware ID and a canonical sourceId.
     */
    fun registerDeviceMapping(hardwareId: String, canonicalSourceId: String) {
        canonicalToHardwareMap[canonicalSourceId] = hardwareId
        hardwareToCanonicalMap[hardwareId] = canonicalSourceId
        Log.d(TAG, "Registered mapping: hardwareId=$hardwareId <-> canonicalSourceId=$canonicalSourceId")
    }

    /**
     * Computes the stable physical hardware identifier for a UsbDevice.
     *
     * HARDWARE IDENTITY INVARIANTS:
     * 1. When USB serial number is available and readable, it is used as the strongest physical hardware identity.
     * 2. When USB serial number is unavailable or unreadable, the deterministic SHA-256 descriptor hash of
     *    manufacturerName + productName is used as a BEST-EFFORT hardware fingerprint, not a mathematical guarantee
     *    of unique physical-device identity.
     * 3. NEVER uses VID+PID alone; always combines VID+PID with serial or descriptor hash to isolate different drives.
     * 4. NEVER includes Firebase Anonymous UID.
     */
    fun computeHardwareId(device: UsbDevice): String {
        val vid = device.vendorId
        val pid = device.productId

        val serial = try {
            device.serialNumber?.trim()
        } catch (_: SecurityException) {
            null
        } catch (_: Throwable) {
            null
        }

        if (!serial.isNullOrEmpty() && serial != "null" && serial != "0") {
            return if (vid > 0 && pid > 0) {
                "$vid-$pid-$serial"
            } else {
                "SN-$serial"
            }
        }

        val manufacturer = try { device.manufacturerName } catch (_: Throwable) { null }
        val product = try { device.productName } catch (_: Throwable) { null }
        val raw = "${manufacturer ?: ""}_${product ?: ""}"
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        val fallbackHash = digest.joinToString("") { "%02x".format(it) }.take(8)

        return if (vid > 0 && pid > 0) {
            "$vid-$pid-$fallbackHash"
        } else {
            "DEV-$fallbackHash"
        }
    }

    /**
     * Resolves the stable WorkManager unique work key for a backup task.
     *
     * The unique work key is derived from the PHYSICAL HARDWARE IDENTITY of the USB device,
     * ensuring that:
     * - Raw attach before filesystem mount (e.g. UsbEventReceiver)
     * - Canonical mounted handoff (e.g. MainActivity)
     * - Reconciliation and reconnect
     * all resolve to the EXACT SAME unique work name for the same physical USB drive.
     *
     * Invariants:
     * - NEVER uses VID+PID alone.
     * - NEVER includes Firebase Anonymous UID.
     * - Two different physical drives with the same VID/PID but different serials or descriptor fingerprints
     *   produce different work keys and remain isolated.
     */
    fun resolveWorkKey(context: Context?, sourceId: String, hintDevice: UsbDevice? = null): String {
        // 1. If hintDevice is provided directly, compute its hardware identity
        if (hintDevice != null) {
            val hwId = computeHardwareId(hintDevice)
            if (isCanonicalSourceId(sourceId)) {
                registerDeviceMapping(hwId, sourceId)
            }
            return hwId
        }

        // 2. Check if this canonical sourceId was already mapped to a physical hardwareId
        val mappedHardwareId = canonicalToHardwareMap[sourceId]
        if (!mappedHardwareId.isNullOrEmpty()) {
            return mappedHardwareId
        }

        // 3. If sourceId is already a raw hardware ID format, use it directly
        if (isRawHardwareId(sourceId)) {
            return sourceId
        }

        // 4. Try resolving connected UsbDevice with matching VID/PID from context
        if (context != null) {
            val parsed = parseSourceComponents(sourceId, context)
            if (parsed.vendorId > 0 && parsed.productId > 0) {
                val matchingDevice = findConnectedDeviceByVidPid(context, parsed.vendorId, parsed.productId)
                if (matchingDevice != null) {
                    val hwId = computeHardwareId(matchingDevice)
                    registerDeviceMapping(hwId, sourceId)
                    return hwId
                }
            } else if (parsed.volumeUuid != null) {
                val device = findMassStorageDevice(context)
                if (device != null) {
                    val hwId = computeHardwareId(device)
                    registerDeviceMapping(hwId, sourceId)
                    return hwId
                }
            }
        }

        // 5. Fallback: preserve sourceId directly (safe fallback for tests/non-USB)
        return sourceId
    }

    /**
     * Extracts the volume UUID component from a sourceId.
     * - "1234-5678-8F12-3456" -> "8F12-3456"
     * - "VOL-8F12-3456" -> "8F12-3456"
     * - "8F12-3456" -> "8F12-3456"
     * - "SN-..." or "DEV-..." -> null (non-volume fallbacks)
     */
    fun extractVolumeUuidFromSourceId(sourceId: String): String? {
        val clean = sourceId.trim().uppercase(Locale.ROOT)
        if (clean.startsWith("SN-") || clean.startsWith("DEV-") || clean == "UNKNOWN") {
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

    /**
     * Determines if [sourceIdA] and [sourceIdB] refer to the exact same physical storage volume.
     * Two source IDs are equivalent if they share the same non-null volume UUID.
     */
    fun isSamePhysicalVolume(sourceIdA: String?, sourceIdB: String?): Boolean {
        if (sourceIdA.isNullOrBlank() || sourceIdB.isNullOrBlank()) return false
        if (sourceIdA.equals(sourceIdB, ignoreCase = true)) return true
        val uuidA = extractVolumeUuidFromSourceId(sourceIdA) ?: return false
        val uuidB = extractVolumeUuidFromSourceId(sourceIdB) ?: return false
        return uuidA.equals(uuidB, ignoreCase = true)
    }

    /**
     * Chooses the more specific, descriptive source ID between [currentId] and [newCandidateId].
     * If both refer to the same physical volume (matching volume UUID), preserves the one containing
     * vendorId-productId hardware identity rather than downgrading to a bare "VOL-{uuid}".
     */
    fun preferSpecificSourceId(currentId: String, newCandidateId: String?): String {
        if (newCandidateId.isNullOrBlank()) return currentId
        if (currentId == newCandidateId) return currentId
        if (!isSamePhysicalVolume(currentId, newCandidateId)) return newCandidateId

        val currentHasVidPid = Regex("""^\d+-\d+-.+$""").matches(currentId)
        val candidateHasVidPid = Regex("""^\d+-\d+-.+$""").matches(newCandidateId)

        return when {
            currentHasVidPid && !candidateHasVidPid -> currentId
            !currentHasVidPid && candidateHasVidPid -> newCandidateId
            else -> currentId
        }
    }

    fun isRawHardwareId(sourceId: String): Boolean {
        if (sourceId.startsWith("DEV-") || sourceId.startsWith("SN-")) return true
        val vidPidRegex = Regex("""^(\d+)-(\d+)-([0-9a-fA-F]{8})$""")
        return vidPidRegex.matches(sourceId)
    }

    fun isCanonicalSourceId(sourceId: String): Boolean {
        if (sourceId.startsWith("VOL-")) return true
        return !isRawHardwareId(sourceId)
    }

    fun canonicalizeSourceId(context: Context?, rawOrCanonicalSourceId: String, hintDevice: UsbDevice? = null): String? {
        // 1. If it's already canonical (e.g. 1008-8195-0CF3-4237 or VOL-...), return as-is
        if (!isRawHardwareId(rawOrCanonicalSourceId)) {
            return rawOrCanonicalSourceId
        }

        // 2. Check if we already have a mapped canonical sourceId for this hardwareId
        val mappedCanonical = hardwareToCanonicalMap[rawOrCanonicalSourceId]
        if (!mappedCanonical.isNullOrEmpty()) {
            return mappedCanonical
        }

        // 3. Try resolving canonical from system if context is available
        if (context != null) {
            val canonical = resolveCanonicalSourceId(context, hintDevice)
            if (canonical != null && !isRawHardwareId(canonical)) {
                registerDeviceMapping(rawOrCanonicalSourceId, canonical)
                return canonical
            }
        }

        return null
    }

    data class ParsedSourceComponents(
        val vendorId: Int,
        val productId: Int,
        val volumeUuid: String?,
        val serialNumber: String?
    )

    fun parseSourceComponents(sourceId: String, context: Context? = null): ParsedSourceComponents {
        var vid = 0
        var pid = 0
        var volumeUuid: String? = null
        var serial: String? = null

        val vidPidRegex = Regex("""^(\d+)-(\d+)-(.+)$""")
        val match = vidPidRegex.find(sourceId)
        if (match != null) {
            vid = match.groupValues[1].toIntOrNull() ?: 0
            pid = match.groupValues[2].toIntOrNull() ?: 0
            val suffix = match.groupValues[3]

            val mountedUuid = if (context != null) findRemovableVolumeUuid(context) else null
            if (mountedUuid != null && suffix.equals(mountedUuid, ignoreCase = true)) {
                volumeUuid = mountedUuid
            } else if (suffix.contains("-") || suffix.length > 8) {
                volumeUuid = suffix
            } else if (suffix.length == 8 && suffix.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' }) {
                if (mountedUuid?.replace("-", "")?.equals(suffix, ignoreCase = true) == true) {
                    volumeUuid = mountedUuid
                }
            } else {
                serial = suffix
            }
        } else if (sourceId.startsWith("VOL-")) {
            volumeUuid = sourceId.removePrefix("VOL-")
        } else if (sourceId.startsWith("SN-")) {
            serial = sourceId.removePrefix("SN-")
        }

        if (context != null && (vid > 0 && pid > 0)) {
            val device = findConnectedDeviceByVidPid(context, vid, pid)
            if (device != null) {
                if (serial == null) {
                    serial = try { device.serialNumber?.trim() } catch (_: Throwable) { null }
                }
            }
        }

        if (volumeUuid == null && context != null) {
            volumeUuid = findRemovableVolumeUuid(context)
        }

        return ParsedSourceComponents(
            vendorId = vid,
            productId = pid,
            volumeUuid = volumeUuid,
            serialNumber = serial
        )
    }

    fun findConnectedDeviceByVidPid(context: Context, vendorId: Int, productId: Int): UsbDevice? {
        val usbManager = context.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return null
        return usbManager.deviceList.values.firstOrNull { it.vendorId == vendorId && it.productId == productId }
    }

    /**
     * Resolves the canonical sourceId by querying active system storage volumes and USB devices.
     * When volume is unmounted, falls back to hardware identity for pre-mount tracking.
     * NOTE: For gating actual backup execution, use [resolveMountedCanonicalSourceId] instead.
     */
    fun resolveCanonicalSourceId(context: Context, hintDevice: UsbDevice? = null): String? {
        // 1. Primary: Find mounted removable StorageVolume UUID
        val volumeUuid = findRemovableVolumeUuid(context)

        // 2. Supplemental: Find matching or active USB mass storage device
        val device = hintDevice ?: findMassStorageDevice(context)

        if (volumeUuid == null && device == null) {
            return null
        }

        val canonical = computeSourceId(volumeUuid, device)
        if (device != null) {
            val hwId = computeHardwareId(device)
            registerDeviceMapping(hwId, canonical)
        }
        return canonical
    }

    /**
     * Resolves the canonical sourceId ONLY when a removable storage volume is ACTUALLY mounted and readable.
     * Returns null if the volume is unmounted, checking, detached, or directory is unreadable.
     *
     * Guarantee: Non-null return value is ALWAYS in format:
     * - "{vid}-{pid}-{volumeUuid}" (when mass storage device is present)
     * - "VOL-{volumeUuid}" (when volume is mounted without device handle)
     * It NEVER falls back to serial number or descriptor hash.
     */
    fun resolveMountedCanonicalSourceId(context: Context, hintDevice: UsbDevice? = null): String? {
        val volumeUuid = findMountedRemovableVolumeUuid(context) ?: return null
        val device = hintDevice ?: findMassStorageDevice(context)

        val canonical = computeSourceId(volumeUuid, device)
        if (device != null) {
            val hwId = computeHardwareId(device)
            registerDeviceMapping(hwId, canonical)
        }
        return canonical
    }

    /**
     * Checks whether removable USB storage is mounted and readable.
     */
    fun isStorageMountedAndReadable(context: Context, hintDevice: UsbDevice? = null): Boolean {
        return findMountedRemovableVolumeUuid(context) != null
    }

    /**
     * Finds the UUID of an ACTUALLY mounted and readable removable storage volume.
     * Returns null if unmounted, checking, or unreadable.
     */
    fun findMountedRemovableVolumeUuid(context: Context): String? {
        // Query StorageManager (API 24+)
        try {
            val volumes = testStorageVolumesProvider?.invoke(context) ?: run {
                val sm = context.getSystemService(StorageManager::class.java)
                sm?.storageVolumes ?: emptyList()
            }

            val removableVolumes = volumes.filter { it.isRemovable && !it.isPrimary }
            for (volume in removableVolumes) {
                val state = try { volume.state } catch (_: Throwable) { null }
                if (!state.isNullOrBlank() && state != android.os.Environment.MEDIA_MOUNTED) {
                    continue
                }

                val uuid = volume.uuid?.trim()?.uppercase(Locale.ROOT)
                val dirName = try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) volume.directory?.name else null
                } catch (_: Throwable) { null }
                val effectiveUuid = if (!uuid.isNullOrBlank()) uuid else dirName?.trim()?.uppercase(Locale.ROOT)

                if (!effectiveUuid.isNullOrBlank()) {
                    // Check directory readability if directory is accessible
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        val dir = try { volume.directory } catch (_: Throwable) { null }
                        if (dir != null && dir.exists() && dir.isDirectory && dir.canRead()) {
                            return effectiveUuid
                        }
                    }

                    // Direct path check under /storage or /mnt/media_rw
                    val candidate1 = File("/storage/$effectiveUuid")
                    if (candidate1.exists() && candidate1.isDirectory && candidate1.canRead()) {
                        return effectiveUuid
                    }
                    val candidate2 = File("/mnt/media_rw/$effectiveUuid")
                    if (candidate2.exists() && candidate2.isDirectory && candidate2.canRead()) {
                        return effectiveUuid
                    }

                    // Test environment override fallback
                    if (testStorageVolumesProvider != null) {
                        val testDirs = testMountedStorageDirectoriesProvider?.invoke(context)
                        if (testDirs != null) {
                            if (testDirs.any { it.name.equals(effectiveUuid, ignoreCase = true) && it.canRead() }) {
                                return effectiveUuid
                            }
                        } else {
                            return effectiveUuid
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed inspecting StorageVolumes: ${e.message}")
        }

        // Direct directory inspection under /storage
        try {
            val candidateDirs = testMountedStorageDirectoriesProvider?.invoke(context) ?: run {
                val storageRoot = File("/storage")
                if (storageRoot.exists() && storageRoot.isDirectory && storageRoot.canRead()) {
                    storageRoot.listFiles()?.filter { f ->
                        f.isDirectory && f.canRead() &&
                                f.name != "emulated" && f.name != "self" && f.name != "knox-emulated" && f.name != "sdcard0"
                    } ?: emptyList()
                } else emptyList()
            }

            for (dir in candidateDirs) {
                val name = dir.name.trim().uppercase(Locale.ROOT)
                val hasEntries = try { dir.listFiles()?.isNotEmpty() == true } catch (_: Throwable) { false }
                if (name.isNotEmpty() && name != "EMULATED" && name != "SELF" && name != "KNOX-EMULATED" && name != "SDCARD0" && dir.canRead() && (testMountedStorageDirectoriesProvider != null || hasEntries)) {
                    return name
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed inspecting /storage directory: ${e.message}")
        }

        return null
    }

    /**
     * Finds removable volume UUID from StorageManager or /storage directory (without requiring mount state validation).
     * Used for mapping/inspection and resolving sourceId when volume structure is known.
     */
    fun findRemovableVolumeUuid(context: Context): String? {
        // Query StorageManager (API 24+)
        try {
            val volumes = testStorageVolumesProvider?.invoke(context) ?: run {
                val sm = context.getSystemService(StorageManager::class.java)
                sm?.storageVolumes ?: emptyList()
            }

            val removableVolume = volumes.firstOrNull { it.isRemovable && !it.isPrimary }
            if (removableVolume != null) {
                val uuid = removableVolume.uuid?.trim()?.uppercase(Locale.ROOT)
                if (!uuid.isNullOrBlank()) {
                    return uuid
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val dirName = try { removableVolume.directory?.name } catch (_: Throwable) { null }
                    if (!dirName.isNullOrBlank()) {
                        return dirName.trim().uppercase(Locale.ROOT)
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed inspecting StorageVolumes: ${e.message}")
        }

        // Direct directory inspection under /storage
        try {
            val candidateDirs = testMountedStorageDirectoriesProvider?.invoke(context) ?: run {
                val storageRoot = File("/storage")
                if (storageRoot.exists() && storageRoot.isDirectory) {
                    storageRoot.listFiles()?.filter { f ->
                        f.isDirectory &&
                                f.name != "emulated" && f.name != "self" && f.name != "knox-emulated" && f.name != "sdcard0"
                    } ?: emptyList()
                } else emptyList()
            }

            for (dir in candidateDirs) {
                val name = dir.name.trim().uppercase(Locale.ROOT)
                if (name.isNotEmpty() && name != "EMULATED" && name != "SELF" && name != "KNOX-EMULATED" && name != "SDCARD0") {
                    return name
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed inspecting /storage directory: ${e.message}")
        }

        return null
    }

    /**
     * Checks if a physical USB mass storage device is currently attached to the phone bus.
     */
    fun isPhysicalUsbAttached(context: Context, sourceId: String? = null): Boolean {
        if (!sourceId.isNullOrBlank()) {
            val parsed = parseSourceComponents(sourceId, context)
            if (parsed.vendorId > 0 && parsed.productId > 0) {
                val dev = findConnectedDeviceByVidPid(context, parsed.vendorId, parsed.productId)
                if (dev != null) return true
            }
        }
        return findMassStorageDevice(context) != null
    }

    fun findMassStorageDevice(context: Context): UsbDevice? {
        val usbManager = context.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return null
        return usbManager.deviceList.values.firstOrNull { isMassStorage(it) }
    }

    fun isMassStorage(device: UsbDevice): Boolean {
        if (device.deviceClass == UsbConstants.USB_CLASS_MASS_STORAGE) {
            return true
        }
        for (i in 0 until device.interfaceCount) {
            if (device.getInterface(i).interfaceClass == UsbConstants.USB_CLASS_MASS_STORAGE) {
                return true
            }
        }
        return false
    }
}
