package com.usbcloudbackup.storage

import android.content.Context
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import io.mockk.every
import io.mockk.mockk
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SourceIdResolverTest {

    @Before
    fun setUp() {
        SourceIdResolver.testStorageVolumesProvider = null
        SourceIdResolver.testMountedStorageDirectoriesProvider = null
    }

    @After
    fun tearDown() {
        SourceIdResolver.testStorageVolumesProvider = null
        SourceIdResolver.testMountedStorageDirectoriesProvider = null
    }

    // 1. USB attach path
    @Test
    fun testUsbAttachPathResolvesCanonicalSourceId() {
        val volume = mockk<StorageVolume>(relaxed = true)
        every { volume.isRemovable } returns true
        every { volume.isPrimary } returns false
        every { volume.uuid } returns "FAC5-5D5E"

        SourceIdResolver.testStorageVolumesProvider = { listOf(volume) }

        val usbDevice = mockk<UsbDevice>(relaxed = true)
        every { usbDevice.vendorId } returns 1008
        every { usbDevice.productId } returns 8195
        every { usbDevice.serialNumber } returns "071C3C679AABC178"

        val context = mockk<Context>(relaxed = true)
        val sm = mockk<StorageManager>(relaxed = true)
        every { sm.storageVolumes } returns listOf(volume)
        every { context.getSystemService(StorageManager::class.java) } returns sm

        val sourceId = SourceIdResolver.resolveCanonicalSourceId(context, usbDevice)
        assertEquals("1008-8195-FAC5-5D5E", sourceId)
    }

    // 2. Reconciliation path
    @Test
    fun testReconciliationPathResolvesSameCanonicalSourceId() {
        val volume = mockk<StorageVolume>(relaxed = true)
        every { volume.isRemovable } returns true
        every { volume.isPrimary } returns false
        every { volume.uuid } returns "FAC5-5D5E"

        SourceIdResolver.testStorageVolumesProvider = { listOf(volume) }

        val usbDevice = mockk<UsbDevice>(relaxed = true)
        every { usbDevice.vendorId } returns 1008
        every { usbDevice.productId } returns 8195
        every { usbDevice.serialNumber } returns "071C3C679AABC178"
        every { usbDevice.interfaceCount } returns 1
        val iface = mockk<UsbInterface>(relaxed = true)
        every { iface.interfaceClass } returns UsbConstants.USB_CLASS_MASS_STORAGE
        every { usbDevice.getInterface(0) } returns iface

        val context = mockk<Context>(relaxed = true)
        val usbManager = mockk<UsbManager>(relaxed = true)
        every { usbManager.deviceList } returns hashMapOf("dev1" to usbDevice)
        every { context.getSystemService(Context.USB_SERVICE) } returns usbManager

        val sourceId = SourceIdResolver.resolveCanonicalSourceId(context, null)
        assertEquals("1008-8195-FAC5-5D5E", sourceId)
    }

    // 3. Already-mounted USB after reboot
    @Test
    fun testAlreadyMountedUsbAfterReboot() {
        val usbDevice = mockk<UsbDevice>(relaxed = true)
        every { usbDevice.vendorId } returns 1008
        every { usbDevice.productId } returns 8195
        every { usbDevice.serialNumber } returns null

        val sourceId = SourceIdResolver.computeSourceId("FAC5-5D5E", usbDevice)
        assertEquals("1008-8195-FAC5-5D5E", sourceId)
    }

    // 4. USB reinsertion
    @Test
    fun testUsbReinsertionProducesSameSourceId() {
        val dev1 = mockk<UsbDevice>(relaxed = true)
        every { dev1.vendorId } returns 1008
        every { dev1.productId } returns 8195
        every { dev1.serialNumber } returns null

        val idBefore = SourceIdResolver.computeSourceId("FAC5-5D5E", dev1)

        val dev2 = mockk<UsbDevice>(relaxed = true)
        every { dev2.vendorId } returns 1008
        every { dev2.productId } returns 8195
        every { dev2.serialNumber } returns "071C3C679AABC178"

        val idAfter = SourceIdResolver.computeSourceId("FAC5-5D5E", dev2)

        assertEquals("1008-8195-FAC5-5D5E", idBefore)
        assertEquals(idBefore, idAfter)
    }

    // 5. Different UsbDevice objects representing the same physical drive
    @Test
    fun testDifferentUsbDeviceObjectsSamePhysicalDrive() {
        val devA = mockk<UsbDevice>(relaxed = true)
        every { devA.vendorId } returns 1008
        every { devA.productId } returns 8195
        every { devA.serialNumber } returns null

        val devB = mockk<UsbDevice>(relaxed = true)
        every { devB.vendorId } returns 1008
        every { devB.productId } returns 8195
        every { devB.serialNumber } returns "OTHER_SERIAL"

        val idA = SourceIdResolver.computeSourceId("FAC5-5D5E", devA)
        val idB = SourceIdResolver.computeSourceId("FAC5-5D5E", devB)

        assertEquals("1008-8195-FAC5-5D5E", idA)
        assertEquals(idA, idB)
    }

    // 6. Same physical drive across different Android phones
    @Test
    fun testSamePhysicalDriveAcrossDifferentAndroidPhones() {
        // Phone 1 (Pixel)
        val pixelDev = mockk<UsbDevice>(relaxed = true)
        every { pixelDev.vendorId } returns 1008
        every { pixelDev.productId } returns 8195
        val phone1SourceId = SourceIdResolver.computeSourceId("FAC5-5D5E", pixelDev)

        // Phone 2 (Vivo)
        val vivoDev = mockk<UsbDevice>(relaxed = true)
        every { vivoDev.vendorId } returns 1008
        every { vivoDev.productId } returns 8195
        val phone2SourceId = SourceIdResolver.computeSourceId("FAC5-5D5E", vivoDev)

        assertEquals("1008-8195-FAC5-5D5E", phone1SourceId)
        assertEquals(phone1SourceId, phone2SourceId)
    }

    // 7. Two different physical drives with different volume UUIDs
    @Test
    fun testTwoDifferentPhysicalDrivesDifferentVolumeUuids() {
        val dev1 = mockk<UsbDevice>(relaxed = true)
        every { dev1.vendorId } returns 1008
        every { dev1.productId } returns 8195

        val dev2 = mockk<UsbDevice>(relaxed = true)
        every { dev2.vendorId } returns 2000
        every { dev2.productId } returns 3000

        val id1 = SourceIdResolver.computeSourceId("FAC5-5D5E", dev1)
        val id2 = SourceIdResolver.computeSourceId("8F12-3456", dev2)

        assertNotEquals(id1, id2)
        assertEquals("1008-8195-FAC5-5D5E", id1)
        assertEquals("2000-3000-8F12-3456", id2)
    }

    // 8. Identical USB hardware with different volume UUIDs
    @Test
    fun testIdenticalHardwareWithDifferentVolumeUuids() {
        val devA = mockk<UsbDevice>(relaxed = true)
        every { devA.vendorId } returns 1008
        every { devA.productId } returns 8195

        val devB = mockk<UsbDevice>(relaxed = true)
        every { devB.vendorId } returns 1008
        every { devB.productId } returns 8195

        val idA = SourceIdResolver.computeSourceId("FAC5-5D5E", devA)
        val idB = SourceIdResolver.computeSourceId("BEEF-CAFE", devB)

        assertNotEquals(idA, idB)
        assertEquals("1008-8195-FAC5-5D5E", idA)
        assertEquals("1008-8195-BEEF-CAFE", idB)
    }

    // 9. Missing USB serial number (e.g. SecurityException or null)
    @Test
    fun testMissingUsbSerialNumberDoesNotAffectVolumeUuidAnchor() {
        val devWithSecEx = mockk<UsbDevice>(relaxed = true)
        every { devWithSecEx.vendorId } returns 1008
        every { devWithSecEx.productId } returns 8195
        every { devWithSecEx.serialNumber } throws SecurityException("Requires permission")

        val sourceId = SourceIdResolver.computeSourceId("FAC5-5D5E", devWithSecEx)
        assertEquals("1008-8195-FAC5-5D5E", sourceId)
    }

    // 10. Missing volume UUID fallback
    @Test
    fun testMissingVolumeUuidFallbackUsesSerialOrHash() {
        val devWithSerial = mockk<UsbDevice>(relaxed = true)
        every { devWithSerial.vendorId } returns 1008
        every { devWithSerial.productId } returns 8195
        every { devWithSerial.serialNumber } returns "071C3C679AABC178"

        val idWithSerial = SourceIdResolver.computeSourceId(null, devWithSerial)
        assertEquals("1008-8195-071C3C679AABC178", idWithSerial)

        val devWithoutSerial = mockk<UsbDevice>(relaxed = true)
        every { devWithoutSerial.vendorId } returns 1008
        every { devWithoutSerial.productId } returns 8195
        every { devWithoutSerial.serialNumber } returns null
        every { devWithoutSerial.manufacturerName } returns "SanDisk"
        every { devWithoutSerial.productName } returns "Ultra"

        val idWithoutSerial = SourceIdResolver.computeSourceId(null, devWithoutSerial)
        assertTrue(idWithoutSerial.startsWith("1008-8195-"))
        assertEquals(18, idWithoutSerial.length)
    }

    // 11. sourceId stability after app restart
    @Test
    fun testSourceIdStabilityAfterAppRestart() {
        val idBeforeRestart = SourceIdResolver.computeSourceId("FAC5-5D5E", vendorId = 1008, productId = 8195)
        val idAfterRestart = SourceIdResolver.computeSourceId("FAC5-5D5E", vendorId = 1008, productId = 8195)
        assertEquals(idBeforeRestart, idAfterRestart)
    }

    // 12. sourceId stability after Firebase anonymous UID changes
    @Test
    fun testSourceIdStabilityIndependentOfFirebaseAnonymousUid() {
        val anonymousUid1 = "user_anon_11111"
        val anonymousUid2 = "user_anon_22222"

        val id1 = SourceIdResolver.computeSourceId("FAC5-5D5E", vendorId = 1008, productId = 8195)
        val id2 = SourceIdResolver.computeSourceId("FAC5-5D5E", vendorId = 1008, productId = 8195)

        assertEquals("1008-8195-FAC5-5D5E", id1)
        assertEquals(id1, id2)
    }

    // 13. Mount readiness: unmounted volume returns null even with USB device serial present
    @Test
    fun testResolveMountedCanonicalSourceIdReturnsNullWhenVolumeUnmountedEvenWithDeviceSerial() {
        val usbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "071C3C679AABC178"
        }
        val context = mockk<Context>(relaxed = true)
        val sm = mockk<StorageManager>(relaxed = true)
        every { sm.storageVolumes } returns emptyList()
        every { context.getSystemService(StorageManager::class.java) } returns sm

        SourceIdResolver.testStorageVolumesProvider = { emptyList() }

        // resolveCanonicalSourceId falls back to hardware serial for pre-mount mapping
        val preMountSourceId = SourceIdResolver.resolveCanonicalSourceId(context, usbDevice)
        assertEquals("1008-8195-071C3C679AABC178", preMountSourceId)

        // BUT resolveMountedCanonicalSourceId MUST return null because volume is unmounted!
        val mountedSourceId = SourceIdResolver.resolveMountedCanonicalSourceId(context, usbDevice)
        org.junit.Assert.assertNull(mountedSourceId)
        org.junit.Assert.assertFalse(SourceIdResolver.isStorageMountedAndReadable(context, usbDevice))
    }

    // 14. Mount readiness: mounted volume resolves canonical sourceId
    @Test
    fun testResolveMountedCanonicalSourceIdReturnsCanonicalWhenMounted() {
        val volume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "0CF3-4237"
            every { state } returns android.os.Environment.MEDIA_MOUNTED
        }
        val usbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "071C3C679AABC178"
        }
        val context = mockk<Context>(relaxed = true)
        SourceIdResolver.testStorageVolumesProvider = { listOf(volume) }

        val mountedSourceId = SourceIdResolver.resolveMountedCanonicalSourceId(context, usbDevice)
        assertEquals("1008-8195-0CF3-4237", mountedSourceId)
        org.junit.Assert.assertTrue(SourceIdResolver.isStorageMountedAndReadable(context, usbDevice))
    }

    // 15. Strict identity separation: WorkManager work key vs mounted canonical sourceId
    @Test
    fun testIdentitySeparationWorkKeyVersusMountedCanonicalSourceId() {
        val volume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "0CF3-4237"
            every { state } returns android.os.Environment.MEDIA_MOUNTED
        }
        val usbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "071C3C679AABC178"
        }
        val context = mockk<Context>(relaxed = true)
        SourceIdResolver.testStorageVolumesProvider = { listOf(volume) }

        // 1. Mounted canonical sourceId MUST be {VID}-{PID}-{volumeUuid}
        val mountedCanonical = SourceIdResolver.resolveMountedCanonicalSourceId(context, usbDevice)
        assertEquals("1008-8195-0CF3-4237", mountedCanonical)

        // 2. WorkManager unique key MUST be based on stable physical hardware identity
        val workKey = SourceIdResolver.resolveWorkKey(context, mountedCanonical!!, usbDevice)
        assertEquals("1008-8195-071C3C679AABC178", workKey)

        // 3. Hardware identity and canonical sourceId must NOT be equal
        assertNotEquals(mountedCanonical, workKey)
        assertTrue(mountedCanonical.endsWith("0CF3-4237"))
        assertTrue(workKey.endsWith("071C3C679AABC178"))
    }
}
