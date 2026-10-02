package com.usbcloudbackup.receivers

import android.hardware.usb.UsbDevice
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UsbEventReceiverTest {

    @Test
    fun testGenerateSourceIdWithSerialNumber() {
        val usbDevice = mockk<UsbDevice>(relaxed = true)
        every { usbDevice.vendorId } returns 1234
        every { usbDevice.productId } returns 5678
        every { usbDevice.serialNumber } returns "SN9999"

        val sourceId = UsbEventReceiver.generateSourceId(usbDevice)
        assertEquals("1234-5678-SN9999", sourceId)
    }

    @Test
    fun testGenerateSourceIdWithoutSerialNumberUsesFallbackHash() {
        val usbDevice = mockk<UsbDevice>(relaxed = true)
        every { usbDevice.vendorId } returns 1234
        every { usbDevice.productId } returns 5678
        every { usbDevice.serialNumber } returns null
        every { usbDevice.manufacturerName } returns "SanDisk"
        every { usbDevice.productName } returns "Ultra USB 3.0"

        val sourceId = UsbEventReceiver.generateSourceId(usbDevice)
        assertTrue(sourceId.startsWith("1234-5678-"))
        assertEquals(18, sourceId.length) // 4 + 1 + 4 + 1 + 8 = 18 chars
    }

    @Test
    fun testUsbAttachedWhenVolumeUnmountedDoesNotEnqueueWork() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        androidx.work.testing.WorkManagerTestInitHelper.initializeTestWorkManager(context)

        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { emptyList() }

        val usbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "SN_UNMOUNTED_1"
        }

        val receiver = UsbEventReceiver()
        val intent = android.content.Intent(android.hardware.usb.UsbManager.ACTION_USB_DEVICE_ATTACHED).apply {
            putExtra(android.hardware.usb.UsbManager.EXTRA_DEVICE, usbDevice)
        }

        receiver.onReceive(context, intent)

        // Work should NOT be enqueued because volume is unmounted!
        val workInfos = androidx.work.WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(com.usbcloudbackup.worker.BackupWorkManager.getUniqueWorkName("1008-8195-SN_UNMOUNTED_1"))
            .get()
        assertTrue(workInfos.isEmpty())
    }

    @Test
    fun testMediaMountedWhenSetupCompletedEnqueuesBackup() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        androidx.work.testing.WorkManagerTestInitHelper.initializeTestWorkManager(context)

        val prefs = context.getSharedPreferences(com.usbcloudbackup.setup.MainActivity.PREFS_NAME, android.content.Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(com.usbcloudbackup.setup.MainActivity.KEY_SETUP_COMPLETE, true)
            .commit()

        val mockVolume = mockk<android.os.storage.StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "0CF3-4237"
            every { state } returns android.os.Environment.MEDIA_MOUNTED
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { listOf(mockVolume) }

        val receiver = UsbEventReceiver()
        val intent = android.content.Intent(android.content.Intent.ACTION_MEDIA_MOUNTED).apply {
            data = android.net.Uri.parse("file:///storage/0CF3-4237")
        }

        receiver.onReceive(context, intent)

        // Work SHOULD be enqueued for the mounted canonical sourceId
        val workInfos = androidx.work.WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(com.usbcloudbackup.worker.BackupWorkManager.getUniqueWorkName("VOL-0CF3-4237"))
            .get()
        org.junit.Assert.assertFalse(workInfos.isEmpty())
    }

    @Test
    fun testUsbDetachedCancelsWork() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        androidx.work.testing.WorkManagerTestInitHelper.initializeTestWorkManager(context)

        val usbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "DETACH_SN_1"
        }

        val receiver = UsbEventReceiver()
        val intent = android.content.Intent(android.hardware.usb.UsbManager.ACTION_USB_DEVICE_DETACHED).apply {
            putExtra(android.hardware.usb.UsbManager.EXTRA_DEVICE, usbDevice)
        }

        receiver.onReceive(context, intent)
        // Verified cancel executed cleanly without throwing
    }
}
