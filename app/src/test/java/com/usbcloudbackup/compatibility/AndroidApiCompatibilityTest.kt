package com.usbcloudbackup.compatibility

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.receivers.UsbEventReceiver
import com.usbcloudbackup.setup.MainActivity
import com.usbcloudbackup.storage.DirectFileStorageSource
import com.usbcloudbackup.storage.SafStorageSource
import com.usbcloudbackup.storage.StorageSourceFactory
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class AndroidApiCompatibilityTest {

    private lateinit var context: Context
    private lateinit var prefs: SharedPreferences

    private class FakeAuthRepository(
        var shouldSucceed: Boolean = true,
        var uid: String = "compat_user_123",
        var defaultMethod: String = "anonymous"
    ) : AuthRepository {
        override fun getCurrentUid(): String? = if (shouldSucceed) uid else null
        override fun isAuthenticated(): Boolean = shouldSucceed
        override suspend fun ensureAuthenticated(): String = uid
        override fun getAuthMethod(): String = defaultMethod
    }

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()

        MainActivity.testAuthRepositoryOverride = FakeAuthRepository()
        MainActivity.testStoragePermissionChecker = null
        MainActivity.testNotificationPermissionChecker = null
    }

    @After
    fun tearDown() {
        prefs.edit().clear().commit()
        MainActivity.testAuthRepositoryOverride = null
        MainActivity.testStoragePermissionChecker = null
        MainActivity.testNotificationPermissionChecker = null
    }

    // --- API 24 (Android 7.0 Nougat) ---
    @Test
    @Config(sdk = [24])
    fun testApi24SetupCompletesInSafMode() {
        MainActivity.testStoragePermissionChecker = { false }
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertTrue(activity.isFinishing)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))
        assertFalse(prefs.getBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true))
        assertEquals("SAF", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }

    @Test
    @Config(sdk = [24])
    fun testApi24StorageFactoryUsesSafFallback() {
        val factory = StorageSourceFactory(context)
        val treeUri = Uri.parse("content://com.android.externalstorage.documents/tree/1234-5678%3A")
        val source = factory.createStorageSource("1234-5678", customUri = treeUri)

        assertTrue(source is SafStorageSource)
        assertEquals("1234-5678", source.sourceId)
    }

    // --- API 25 (Android 7.1 Nougat MR1) ---
    @Test
    @Config(sdk = [25])
    fun testApi25SetupCompletesInSafMode() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertTrue(activity.isFinishing)
        assertEquals("SAF", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }

    // --- API 26 (Android 8.0 Oreo) ---
    @Test
    @Config(sdk = [26])
    fun testApi26NotificationChannelCreationSupported() {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel("test_channel", "Test Channel", NotificationManager.IMPORTANCE_LOW)
        notificationManager.createNotificationChannel(channel)

        val retrievedChannel = notificationManager.getNotificationChannel("test_channel")
        assertNotNull(retrievedChannel)
        assertEquals("test_channel", retrievedChannel.id)
    }

    // --- API 28 (Android 9.0 Pie) ---
    @Test
    @Config(sdk = [28])
    fun testApi28SetupCompletesInSafMode() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertTrue(activity.isFinishing)
        assertEquals("SAF", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }

    // --- API 29 (Android 10.0 Q) ---
    @Test
    @Config(sdk = [29])
    fun testApi29SetupCompletesInSafMode() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertTrue(activity.isFinishing)
        assertEquals("SAF", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }

    // --- API 30 (Android 11.0 R) ---
    @Test
    @Config(sdk = [30])
    fun testApi30SetupDirectFileModeWhenGranted() {
        MainActivity.testStoragePermissionChecker = { true }
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertTrue(activity.isFinishing)
        assertTrue(prefs.getBoolean(MainActivity.KEY_DIRECT_FILE_MODE, false))
        assertEquals("DIRECT_FILE", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }

    // --- API 33 (Android 13.0 Tiramisu) ---
    @Test
    @Config(sdk = [33])
    fun testApi33NotificationPermissionBranching() {
        var notificationPrompted = false
        MainActivity.testNotificationPermissionChecker = {
            notificationPrompted = true
            true
        }
        MainActivity.testStoragePermissionChecker = { true }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertTrue(activity.isFinishing)
        assertTrue(notificationPrompted)
    }

    // --- API 34 (Android 14.0 UpsideDownCake) ---
    @Test
    @Config(sdk = [34])
    fun testApi34FullPipelineConfiguration() {
        MainActivity.testNotificationPermissionChecker = { true }
        MainActivity.testStoragePermissionChecker = { true }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertTrue(activity.isFinishing)
        assertEquals("DIRECT_FILE", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }
}
