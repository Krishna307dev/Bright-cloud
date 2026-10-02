package com.usbcloudbackup.worker

import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.storage.StorageVolume
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import java.util.concurrent.TimeUnit
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.receivers.UsbEventReceiver
import com.usbcloudbackup.setup.MainActivity
import io.mockk.every
import io.mockk.mockk
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UsbAttachAndLifecycleRegressionTest {

    private lateinit var context: Context

    private val fakeAuth = object : AuthRepository {
        override fun getCurrentUid(): String = "test_daemon_uid"
        override fun isAuthenticated(): Boolean = true
        override suspend fun ensureAuthenticated(): String = "test_daemon_uid"
        override fun getAuthMethod(): String = "anonymous"
    }

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()

        MainActivity.testAuthRepositoryOverride = fakeAuth
        MainActivity.testNotificationPermissionChecker = { true }
        MainActivity.testStoragePermissionChecker = { true }
        MainActivity.testHandoffTimeoutMs = 10L
    }

    @After
    fun tearDown() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        MainActivity.testAuthRepositoryOverride = null
        MainActivity.testNotificationPermissionChecker = null
        MainActivity.testStoragePermissionChecker = null
        MainActivity.testSafPickerLauncher = null
        MainActivity.testHandoffTimeoutMs = 2500L
        MainActivity.testMountWaitTimeoutMs = 5000L
        MainActivity.testMountPollIntervalMs = 250L
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = null
        com.usbcloudbackup.storage.SourceIdResolver.testMountedStorageDirectoriesProvider = null
    }

    @Test
    fun testUsbAttachWhenSetupAlreadyCompletedEnqueuesBackupAndFinishes() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_SETUP_COMPLETE, true)
            .putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true)
            .commit()

        val mockStorageVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "ATTACH-UUID-1"
            every { state } returns android.os.Environment.MEDIA_MOUNTED
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { listOf(mockStorageVolume) }

        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1234
            every { productId } returns 5678
            every { serialNumber } returns "TEST_SN_ATTACH_1"
        }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).apply {
            putExtra(UsbManager.EXTRA_DEVICE, mockUsbDevice)
        }

        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()
        ShadowLooper.idleMainLooper(200, java.util.concurrent.TimeUnit.MILLISECONDS)

        // Verify that WorkManager received the unique work request under the stable hardware work key
        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("1234-5678-ATTACH-UUID-1"))
            .get()

        assertNotNull(workInfos)
        assertFalse(workInfos.isEmpty())

        // Verify activity is finishing after handoff
        assertTrue(activity.isFinishing)

        // Verify plain screen: no text views, progress bars, or buttons
        assertNull(activity.findViewById<android.view.View>(com.usbcloudbackup.R.id.tvTitle))
        assertNull(activity.findViewById<android.view.View>(com.usbcloudbackup.R.id.tvStatus))
        assertNull(activity.findViewById<android.view.View>(com.usbcloudbackup.R.id.progressBar))
        assertNull(activity.findViewById<android.view.View>(com.usbcloudbackup.R.id.btnGrantStorage))
    }

    @Test
    fun testUsbAttachDuringFirstRunWithMountedVolumeEnqueuesBackupUponSetupCompletion() {
        val mockStorageVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "ATTACH-UUID-FIRST-RUN"
            every { state } returns android.os.Environment.MEDIA_MOUNTED
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { listOf(mockStorageVolume) }

        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 4321
            every { productId } returns 8765
            every { serialNumber } returns "TEST_SN_ATTACH_FIRST_RUN"
        }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).apply {
            putExtra(UsbManager.EXTRA_DEVICE, mockUsbDevice)
        }

        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()
        ShadowLooper.idleMainLooper()

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))

        val workKey = BackupWorkManager.getUniqueWorkName(context, "4321-8765-ATTACH-UUID-FIRST-RUN", mockUsbDevice)
        assertEquals("backup_4321-8765-TEST_SN_ATTACH_FIRST_RUN", workKey)

        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(workKey)
            .get()

        assertNotNull(workInfos)
        assertEquals(1, workInfos.size)
        assertTrue(activity.isFinishing)
    }

    @Test
    fun testUsbAttachDuringFirstRunWhenVolumeUnmountedDoesNotEnqueueBackupUponSetupCompletion() {
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { emptyList() }

        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 4321
            every { productId } returns 8765
            every { serialNumber } returns "TEST_SN_ATTACH_UNMOUNTED"
        }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).apply {
            putExtra(UsbManager.EXTRA_DEVICE, mockUsbDevice)
        }

        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()
        ShadowLooper.idleMainLooper()

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))

        val workKey = BackupWorkManager.getUniqueWorkName(context, "4321-8765-TEST_SN_ATTACH_UNMOUNTED", mockUsbDevice)
        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(workKey)
            .get()

        assertTrue(workInfos.isEmpty())
        assertTrue(activity.isFinishing)
    }

    @Test
    fun testUsbEventReceiverDetachCancelsUniqueWork() {
        val sourceId = "9999-1111-SN_DETACH_TEST"
        BackupWorkManager.enqueueBackup(context, sourceId)

        val uniqueWorkName = BackupWorkManager.getUniqueWorkName(sourceId)
        var workInfos = WorkManager.getInstance(context).getWorkInfosForUniqueWork(uniqueWorkName).get()
        assertFalse(workInfos.isEmpty())

        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 9999
            every { productId } returns 1111
            every { serialNumber } returns "SN_DETACH_TEST"
        }

        val detachIntent = Intent(UsbManager.ACTION_USB_DEVICE_DETACHED).apply {
            putExtra(UsbManager.EXTRA_DEVICE, mockUsbDevice)
        }

        val receiver = UsbEventReceiver()
        receiver.onReceive(context, detachIntent)
        ShadowLooper.idleMainLooper()

        workInfos = WorkManager.getInstance(context).getWorkInfosForUniqueWork(uniqueWorkName).get()
        assertTrue(workInfos.any { it.state.isFinished || it.state == androidx.work.WorkInfo.State.CANCELLED })
    }

    @Test
    fun testSafPickerLauncherAndPersistedUriHandling() {
        var safPickerLaunched = false
        MainActivity.testSafPickerLauncher = {
            safPickerLaunched = true
        }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        // Simulate SAF tree picker result
        val treeUri = Uri.parse("content://com.android.externalstorage.documents/tree/TEST-USB-UUID%3A")
        val resultData = Intent().apply {
            data = treeUri
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
        }

        activity.onActivityResult(MainActivity.REQUEST_CODE_SAF_TREE, android.app.Activity.RESULT_OK, resultData)
        ShadowLooper.idleMainLooper()

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))
        assertEquals("SAF", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
        assertFalse(prefs.getBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true))
    }

    @Test
    fun testUsbAttachDelayedVolumeMountResolvesAndEnqueuesBackup() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_SETUP_COMPLETE, true)
            .putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true)
            .commit()

        MainActivity.testMountWaitTimeoutMs = 2000L
        MainActivity.testMountPollIntervalMs = 100L
        MainActivity.testHandoffTimeoutMs = 50L

        var volumeMounted = false
        val mockStorageVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "0CF3-4237"
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = {
            if (volumeMounted) listOf(mockStorageVolume) else emptyList()
        }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()

        // Initially volume is not mounted, so activity must be waiting (not finished yet)
        assertFalse(activity.isFinishing)
        ShadowLooper.idleMainLooper(250, TimeUnit.MILLISECONDS)
        assertFalse(activity.isFinishing)

        var workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("VOL-0CF3-4237"))
            .get()
        assertTrue(workInfos.isEmpty())

        // Volume mounts after delay
        volumeMounted = true
        ShadowLooper.idleMainLooper(300, TimeUnit.MILLISECONDS)

        // Work is now enqueued and handoff completes
        workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("VOL-0CF3-4237"))
            .get()
        assertFalse(workInfos.isEmpty())
        assertTrue(activity.isFinishing)
    }

    @Test
    fun testDelayedMountWaitTimeoutWithNoVolumeMountFinishesCleanlyWithoutEnqueuing() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_SETUP_COMPLETE, true)
            .commit()

        MainActivity.testMountWaitTimeoutMs = 300L
        MainActivity.testMountPollIntervalMs = 100L
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { emptyList() }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()

        assertFalse(activity.isFinishing)

        // Advance looper past the 300ms timeout
        ShadowLooper.idleMainLooper(450, TimeUnit.MILLISECONDS)

        // Activity must finish cleanly
        assertTrue(activity.isFinishing)

        // No backup work should ever have been enqueued
        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("VOL-0CF3-4237"))
            .get()
        assertTrue(workInfos.isEmpty())
    }

    @Test
    fun testActivityDestructionDuringWaitAbortsAndDoesNotEnqueue() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_SETUP_COMPLETE, true)
            .commit()

        MainActivity.testMountWaitTimeoutMs = 2000L
        MainActivity.testMountPollIntervalMs = 100L

        var volumeMounted = false
        val mockStorageVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "DESTROY-UUID-1"
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = {
            if (volumeMounted) listOf(mockStorageVolume) else emptyList()
        }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()

        assertFalse(activity.isFinishing)

        // Destroy the activity while it is waiting
        controller.destroy()

        // Volume becomes available after destruction
        volumeMounted = true
        ShadowLooper.idleMainLooper(500, TimeUnit.MILLISECONDS)

        // Verify no work was enqueued after destruction
        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("VOL-DESTROY-UUID-1"))
            .get()
        assertTrue(workInfos.isEmpty())
    }

    @Test
    fun testDuplicateAttachIntentDoesNotEnqueueDuplicateWork() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_SETUP_COMPLETE, true)
            .commit()

        MainActivity.testMountWaitTimeoutMs = 2000L
        MainActivity.testMountPollIntervalMs = 100L
        MainActivity.testHandoffTimeoutMs = 50L

        val mockStorageVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "DUP-UUID-1"
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { listOf(mockStorageVolume) }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()

        // Deliver duplicate attach intent via onNewIntent
        controller.newIntent(attachIntent)
        ShadowLooper.idleMainLooper(200, TimeUnit.MILLISECONDS)

        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("VOL-DUP-UUID-1"))
            .get()
        assertEquals(1, workInfos.size)
        assertTrue(activity.isFinishing)
    }

    @Test
    fun testUsbDetachDuringWaitCancelsPendingHandoff() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_SETUP_COMPLETE, true)
            .commit()

        MainActivity.testMountWaitTimeoutMs = 2000L
        MainActivity.testMountPollIntervalMs = 100L

        var volumeMounted = false
        val mockStorageVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "DETACH-TEST-UUID"
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = {
            if (volumeMounted) listOf(mockStorageVolume) else emptyList()
        }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()

        assertFalse(activity.isFinishing)

        // Detach broadcast delivered while waiting
        val detachIntent = Intent(UsbManager.ACTION_USB_DEVICE_DETACHED)
        controller.newIntent(detachIntent)
        ShadowLooper.idleMainLooper(100, TimeUnit.MILLISECONDS)

        assertTrue(activity.isFinishing)

        // Volume appears later, but pending wait was cancelled
        volumeMounted = true
        ShadowLooper.idleMainLooper(300, TimeUnit.MILLISECONDS)

        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("VOL-DETACH-TEST-UUID"))
            .get()
        assertTrue(workInfos.isEmpty())
    }

    @Test
    fun testUsbAttachWhenVolumeUnmountedWaitsAndDoesNotEnqueueImmediatelyEvenIfDeviceHasSerial() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(MainActivity.KEY_SETUP_COMPLETE, true)
            .putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true)
            .commit()

        MainActivity.testMountWaitTimeoutMs = 2000L
        MainActivity.testMountPollIntervalMs = 100L
        MainActivity.testHandoffTimeoutMs = 50L

        var volumeMounted = false
        val mockStorageVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "LATE-MOUNT-UUID"
            every { state } returns android.os.Environment.MEDIA_MOUNTED
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = {
            if (volumeMounted) listOf(mockStorageVolume) else emptyList()
        }

        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "071C3C679AABC178"
        }

        val attachIntent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).apply {
            putExtra(UsbManager.EXTRA_DEVICE, mockUsbDevice)
        }

        val controller = Robolectric.buildActivity(MainActivity::class.java, attachIntent).setup()
        val activity = controller.get()

        // Volume not mounted: activity should be waiting
        assertFalse(activity.isFinishing)
        ShadowLooper.idleMainLooper(250, TimeUnit.MILLISECONDS)
        assertFalse(activity.isFinishing)

        // Work is NOT enqueued while unmounted
        var workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("1008-8195-LATE-MOUNT-UUID"))
            .get()
        assertTrue(workInfos.isEmpty())

        // Volume mounts after delay
        volumeMounted = true
        ShadowLooper.idleMainLooper(300, TimeUnit.MILLISECONDS)

        // Work is now enqueued and handoff completes
        workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(BackupWorkManager.getUniqueWorkName("1008-8195-LATE-MOUNT-UUID"))
            .get()
        assertFalse(workInfos.isEmpty())
        assertTrue(activity.isFinishing)
    }
}
