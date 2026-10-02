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
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
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
    }

    @After
    fun tearDown() {
        tempRoot.deleteRecursively()
        StorageSourceFactory.testRemovableDirectoryOverride = null
        StorageSourceFactory.testStorageVolumesProvider = null
        StorageSourceFactory.testPersistedUriPermissionsProvider = null
        StorageSourceFactory.testMountedStorageDirectoriesProvider = null
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
}
