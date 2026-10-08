package com.usbcloudbackup.storage

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.storage.StorageVolume
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.setup.MainActivity
import io.mockk.every
import io.mockk.mockk
import java.io.File
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StorageSourceFactoryTest {

    private lateinit var context: Context
    private lateinit var tempRoot: File

    private val testSourceId = "1234-5678-sn001"
    private val testVolumeUuid = "8F12-3456"

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        tempRoot = File(context.cacheDir, "test_storage_${System.currentTimeMillis()}").apply { mkdirs() }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()

        StorageSourceFactory.testRemovableDirectoryOverride = null
        StorageSourceFactory.testStorageVolumesProvider = null
        StorageSourceFactory.testPersistedUriPermissionsProvider = null
        StorageSourceFactory.testMountedStorageDirectoriesProvider = null
        StorageSourceFactory.testProcMountsProvider = null
        StorageSourceFactory.testDirectoryListFilesOverride = null
        StorageSourceFactory.testOemStaticCandidatePaths = null
        StorageSourceFactory.testOemWildcardRoots = null
        DirectFileStorageSource.testListFilesOverride = null
    }

    @After
    fun tearDown() {
        tempRoot.deleteRecursively()
        StorageSourceFactory.testRemovableDirectoryOverride = null
        StorageSourceFactory.testStorageVolumesProvider = null
        StorageSourceFactory.testPersistedUriPermissionsProvider = null
        StorageSourceFactory.testMountedStorageDirectoriesProvider = null
        StorageSourceFactory.testProcMountsProvider = null
        StorageSourceFactory.testDirectoryListFilesOverride = null
        StorageSourceFactory.testOemStaticCandidatePaths = null
        StorageSourceFactory.testOemWildcardRoots = null
        DirectFileStorageSource.testListFilesOverride = null
    }

    @Test
    fun testExplicitCustomUriCreatesSafStorageSource() {
        val factory = StorageSourceFactory(context)
        val customUri = Uri.parse("content://com.android.externalstorage.documents/tree/8F12-3456%3A")

        val source = factory.createStorageSource(testSourceId, customUri = customUri)

        assertTrue(source is SafStorageSource)
        assertEquals(testSourceId, source.sourceId)
    }

    @Test
    fun testResolvesRealMountedVolumeWhenSourceIdDiffersFromVolumeUuid() = runBlocking {
        // Create actual directory on disk representing the mounted removable volume
        val mountedVolumeDir = File(tempRoot, testVolumeUuid).apply {
            mkdirs()
            File(this, "test_file.txt").writeText("sample content")
        }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true)
            .putString(MainActivity.KEY_STORAGE_MODE, "DIRECT_FILE")
            .commit()

        // Mock StorageVolume returning volume.directory = mountedVolumeDir
        val mockVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns testVolumeUuid
            every { directory } returns mountedVolumeDir
        }

        StorageSourceFactory.testStorageVolumesProvider = { listOf(mockVolume) }

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource(testSourceId)

        assertTrue("Should produce DirectFileStorageSource for mounted volume", source is DirectFileStorageSource)
        assertTrue("Storage source should be available", source.isAvailable())

        val files = source.discoverFiles()
        assertEquals(1, files.size)
        assertEquals("test_file.txt", files[0].originalName)
    }

    @Test
    fun testMultipleRemovableVolumesResolvesCorrectMountedVolume() = runBlocking {
        val volumeDir1 = File(tempRoot, "VOL1_UUID").apply {
            mkdirs()
            File(this, "vol1_data.txt").writeText("data1")
        }
        val volumeDir2 = File(tempRoot, "VOL2_UUID").apply {
            mkdirs()
            File(this, "vol2_data.txt").writeText("data2")
        }

        val mockVol1 = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "VOL1_UUID"
            every { directory } returns volumeDir1
        }

        val mockVol2 = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "VOL2_UUID"
            every { directory } returns volumeDir2
        }

        StorageSourceFactory.testStorageVolumesProvider = { listOf(mockVol1, mockVol2) }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource("source-with-VOL2_UUID-serial")

        assertTrue(source is DirectFileStorageSource)
        assertTrue(source.isAvailable())
        val files = source.discoverFiles()
        assertEquals(1, files.size)
        assertEquals("vol2_data.txt", files[0].originalName)
    }

    @Test
    fun testMissingOrUnmountedVolumeGracefullyReturnsUnavailableSource() = runBlocking {
        // No volumes mounted
        StorageSourceFactory.testStorageVolumesProvider = { emptyList() }
        StorageSourceFactory.testMountedStorageDirectoriesProvider = { emptyList() }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource(testSourceId)

        assertNotNull(source)
        assertFalse("Unmounted volume should report isAvailable == false", source.isAvailable())
    }

    @Test
    fun testSafFallbackUsesPersistedUriWhenDirectFileDisabled() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, false)
            .putString(MainActivity.KEY_STORAGE_MODE, "SAF")
            .commit()

        val mockUri = Uri.parse("content://com.android.externalstorage.documents/tree/8F12-3456%3A")
        StorageSourceFactory.testPersistedUriPermissionsProvider = { listOf(mockUri) }

        val factory = StorageSourceFactory(context)

        // 1. Canonical sourceId with VID-PID-UUID
        val matchingSourceIdVidPid = "1234-5678-8F12-3456"
        val source1 = factory.createStorageSource(matchingSourceIdVidPid)
        assertTrue("Should produce SafStorageSource for canonical VID-PID-UUID sourceId", source1 is SafStorageSource)

        // 2. Canonical sourceId with VOL-UUID
        val matchingSourceIdVol = "VOL-8F12-3456"
        val source2 = factory.createStorageSource(matchingSourceIdVol)
        assertTrue("Should produce SafStorageSource for canonical VOL-UUID sourceId", source2 is SafStorageSource)
    }

    @Test
    fun testSafDoesNotFallbackToUnrelatedPersistedUriForDifferentDrive() = runBlocking {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, false)
            .putString(MainActivity.KEY_STORAGE_MODE, "SAF")
            .commit()

        val mockUri = Uri.parse("content://com.android.externalstorage.documents/tree/8F12-3456%3A")
        StorageSourceFactory.testPersistedUriPermissionsProvider = { listOf(mockUri) }

        val factory = StorageSourceFactory(context)

        // 1. Unrelated canonical drive with different UUID
        val unrelatedSourceId = "1234-5678-9999-8888"
        val source1 = factory.createStorageSource(unrelatedSourceId)
        assertFalse("Should NOT use unrelated drive's persisted URI for a different drive", source1 is SafStorageSource)
        assertFalse("Unrelated drive with no matching volume must not be available", source1.isAvailable())

        // 2. Unrelated VOL-UUID
        val unrelatedVolId = "VOL-9999-8888"
        val source2 = factory.createStorageSource(unrelatedVolId)
        assertFalse("Should NOT match different volume UUID under VOL- prefix", source2 is SafStorageSource)

        // 3. Serial-only source (no volume UUID component)
        val serialOnlyId = "SN-8F12-3456"
        val source3 = factory.createStorageSource(serialOnlyId)
        assertFalse("Should NOT match serial-only fallback against volume UUID URI", source3 is SafStorageSource)
    }

    @Test
    @Config(sdk = [24])
    fun testApi24ResolvesVolumeViaUuid() = runBlocking {
        val mountedVolumeDir = File(tempRoot, testVolumeUuid).apply {
            mkdirs()
            File(this, "api24_file.txt").writeText("api 24 test")
        }

        // On API 24, volume.uuid exists, but volume.directory is not available
        val mockVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns testVolumeUuid
        }

        StorageSourceFactory.testStorageVolumesProvider = { listOf(mockVolume) }
        StorageSourceFactory.testMountedStorageDirectoriesProvider = { listOf(mountedVolumeDir) }

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource(testSourceId)

        assertTrue(source is DirectFileStorageSource)
        assertTrue(source.isAvailable())
        val files = source.discoverFiles()
        assertEquals(1, files.size)
        assertEquals("api24_file.txt", files[0].originalName)
    }

    @Test
    fun testReconnectRecreatesAvailableSource() = runBlocking {
        val mountedVolumeDir = File(tempRoot, testVolumeUuid).apply {
            mkdirs()
            File(this, "reconnect.txt").writeText("reconnect test")
        }

        val mockVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns testVolumeUuid
            every { directory } returns mountedVolumeDir
        }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)

        // 1. Initially connected
        StorageSourceFactory.testStorageVolumesProvider = { listOf(mockVolume) }
        val source1 = factory.createStorageSource(testSourceId)
        assertTrue(source1.isAvailable())

        // 2. Disconnected
        StorageSourceFactory.testStorageVolumesProvider = { emptyList() }
        StorageSourceFactory.testMountedStorageDirectoriesProvider = { emptyList() }
        val source2 = factory.createStorageSource(testSourceId)
        assertFalse(source2.isAvailable())

        // 3. Reconnected
        StorageSourceFactory.testStorageVolumesProvider = { listOf(mockVolume) }
        val source3 = factory.createStorageSource(testSourceId)
        assertTrue(source3.isAvailable())
    }

    @Test
    fun testCanonicalCandidateNullProceedsToNextCandidate() = runBlocking {
        // Canonical directory exists, but direct enumeration fails (listFiles returns null)
        val canonicalDir = File(tempRoot, "canonical_$testVolumeUuid").apply { mkdirs() }
        // Fallback candidate directory exists and has files
        val fallbackOemDir = File(tempRoot, "fallback_USB_DISK0").apply {
            mkdirs()
            File(this, "fallback_data.txt").writeText("oem fallback file")
        }

        val mockVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns testVolumeUuid
            every { directory } returns canonicalDir
        }

        StorageSourceFactory.testStorageVolumesProvider = { listOf(mockVolume) }
        StorageSourceFactory.testOemStaticCandidatePaths = listOf(fallbackOemDir)
        // Simulate canonical dir listFiles() == null
        StorageSourceFactory.testDirectoryListFilesOverride = { file ->
            if (file.absolutePath == canonicalDir.absolutePath) null else file.listFiles()
        }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource(testSourceId)

        assertTrue("Should produce DirectFileStorageSource", source is DirectFileStorageSource)
        assertTrue("Source should be available", source.isAvailable())

        val files = source.discoverFiles()
        assertEquals(1, files.size)
        assertEquals("fallback_data.txt", files[0].originalName)
    }

    @Test
    fun testEmptyDirectoryAcceptedAsStorageRoot() = runBlocking {
        // Empty directory on disk (listFiles returns emptyArray)
        val emptyDir = File(tempRoot, "empty_$testVolumeUuid").apply { mkdirs() }

        val mockVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns testVolumeUuid
            every { directory } returns emptyDir
        }

        StorageSourceFactory.testStorageVolumesProvider = { listOf(mockVolume) }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource(testSourceId)

        assertTrue(source is DirectFileStorageSource)
        assertTrue("Empty directory should still report isAvailable == true", source.isAvailable())

        val files = source.discoverFiles()
        assertEquals("Empty directory should discover 0 files", 0, files.size)
    }

    @Test
    fun testDynamicMountDiscoveryFromProcMounts() = runBlocking {
        val canonicalDir = File(tempRoot, "failing_canonical").apply { mkdirs() }
        val dynamicMountDir = File(tempRoot, "dynamic_sda1").apply {
            mkdirs()
            File(this, "proc_mount_file.txt").writeText("dynamic mount")
        }

        val mockVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns testVolumeUuid
            every { directory } returns canonicalDir
        }

        StorageSourceFactory.testStorageVolumesProvider = { listOf(mockVolume) }
        StorageSourceFactory.testDirectoryListFilesOverride = { file ->
            if (file.absolutePath == canonicalDir.absolutePath) null else file.listFiles()
        }
        // Mock /proc/mounts line
        StorageSourceFactory.testProcMountsProvider = {
            listOf(
                "/dev/block/sda1 ${dynamicMountDir.absolutePath} vfat rw,nosuid 0 0"
            )
        }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource(testSourceId)

        assertTrue(source is DirectFileStorageSource)
        assertTrue(source.isAvailable())

        val files = source.discoverFiles()
        assertEquals(1, files.size)
        assertEquals("proc_mount_file.txt", files[0].originalName)
    }

    @Test
    fun testUnrelatedMountRejection() = runBlocking {
        val targetVolumeUuid = "8F12-3456"
        val unrelatedVolumeUuid = "9999-0000"

        val unrelatedMountDir = File(tempRoot, "unrelated_$unrelatedVolumeUuid").apply {
            mkdirs()
            File(this, "unrelated_secret.txt").writeText("secret")
        }

        // Mock /proc/mounts containing an unrelated drive with different UUID
        StorageSourceFactory.testProcMountsProvider = {
            listOf(
                "/dev/block/sdb1 ${unrelatedMountDir.absolutePath} vfat rw 0 0"
            )
        }

        // Wildcard root also containing unrelated mount
        val wildcardParent = File(tempRoot, "mnt_media_rw").apply { mkdirs() }
        val unrelatedChild = File(wildcardParent, unrelatedVolumeUuid).apply {
            mkdirs()
            File(this, "other.txt").writeText("other")
        }
        StorageSourceFactory.testOemWildcardRoots = listOf(wildcardParent)

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)
        // Request source for targetVolumeUuid
        val source = factory.createStorageSource("1234-5678-$targetVolumeUuid")

        assertNotNull(source)
        assertFalse("Unrelated mount must be rejected and not selected", source.isAvailable())
    }

    @Test
    fun testAllCandidatesNullNeverReportsCompletedGracefullyThrows() = runBlocking {
        val failingRoot = File(tempRoot, "completely_failing_root").apply { mkdirs() }

        DirectFileStorageSource.testListFilesOverride = { _ -> null }

        val directSource = DirectFileStorageSource("test-src", "Failing Source", failingRoot)

        assertFalse("When listFiles returns null, isAvailable must be false", directSource.isAvailable())

        try {
            directSource.discoverFiles()
            fail("discoverFiles() should throw IOException when root enumeration fails")
        } catch (e: IOException) {
            assertTrue("Expected enumeration failure message", e.message?.contains("unavailable or unreadable") == true || e.message?.contains("Enumeration failure") == true)
        }
    }

    @Test
    fun testProcMountsExcludesLoopDevicesAndApexMounts() = runBlocking {
        val targetVolumeUuid = "1A55-5F8C"
        val fakeApexDir = File(tempRoot, "mnt_apex_tzdata").apply {
            mkdirs()
            File(this, "apex_manifest.pb").writeText("fake apex")
            File(this, "tzdata").writeText("fake tz")
        }

        // Mock /proc/mounts containing APEX on loop device and system mounts
        StorageSourceFactory.testProcMountsProvider = {
            listOf(
                "/dev/block/loop0 ${fakeApexDir.absolutePath} ext4 ro 0 0",
                "/dev/block/loop1 /apex/com.android.tzdata ext4 ro 0 0",
                "none /mnt/runtime/default/emulated tmpfs rw 0 0"
            )
        }

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource("VOL-$targetVolumeUuid")

        assertNotNull(source)
        assertFalse("Loop device and APEX mount points must be rejected completely", source.isAvailable())
    }

    @Test
    fun testPreferSpecificSourceIdPreservesHardwareIdentity() {
        val specificId = "1008-8195-1A55-5F8C"
        val genericId = "VOL-1A55-5F8C"
        val differentVolumeId = "1008-8195-9999-0000"

        // Same volume: prefer specific over generic
        assertEquals(specificId, SourceIdResolver.preferSpecificSourceId(specificId, genericId))
        assertEquals(specificId, SourceIdResolver.preferSpecificSourceId(genericId, specificId))

        // Different volume: accepts candidate
        assertEquals(differentVolumeId, SourceIdResolver.preferSpecificSourceId(specificId, differentVolumeId))

        // Same physical volume verification
        assertTrue(SourceIdResolver.isSamePhysicalVolume(specificId, genericId))
        assertTrue(SourceIdResolver.isSamePhysicalVolume(genericId, specificId))
        assertFalse(SourceIdResolver.isSamePhysicalVolume(specificId, differentVolumeId))
    }
}
