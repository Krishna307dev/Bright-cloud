package com.usbcloudbackup.setup

import android.content.Context
import android.content.SharedPreferences
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.R
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {

    private lateinit var context: Context
    private lateinit var prefs: SharedPreferences
    private lateinit var fakeFirestoreRepo: FakeFirestoreRepository

    private class FakeAuthRepository(
        var shouldSucceed: Boolean = true,
        var uid: String = "test_user_123",
        var defaultMethod: String = "anonymous"
    ) : AuthRepository {
        var ensureAuthenticatedCallCount = 0

        override fun getCurrentUid(): String? = if (shouldSucceed) uid else null
        override fun isAuthenticated(): Boolean = shouldSucceed
        override suspend fun ensureAuthenticated(): String {
            ensureAuthenticatedCallCount++
            if (!shouldSucceed) {
                throw RuntimeException("Network authentication error")
            }
            return uid
        }
        override fun getAuthMethod(): String = defaultMethod
    }

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()

        MainActivity.testAuthRepositoryOverride = null
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

    @Test
    @Config(sdk = [34])
    fun testAlreadyCompletedSetupFinishesImmediately() {
        prefs.edit()
            .putBoolean(MainActivity.KEY_SETUP_COMPLETE, true)
            .putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true)
            .commit()

        val fakeAuth = FakeAuthRepository()
        MainActivity.testAuthRepositoryOverride = fakeAuth

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertTrue(activity.isFinishing)
        assertEquals(0, fakeAuth.ensureAuthenticatedCallCount)
    }

    @Test
    @Config(sdk = [34])
    fun testFirstRunSignsInAndCompletesSetupHeadless() {
        assertFalse(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))

        val fakeAuth = FakeAuthRepository(shouldSucceed = true, uid = "daemon_uid_777")
        MainActivity.testAuthRepositoryOverride = fakeAuth
        MainActivity.testNotificationPermissionChecker = { true }
        MainActivity.testStoragePermissionChecker = { true }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        ShadowLooper.idleMainLooper()

        assertTrue(activity.isFinishing)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))
        assertEquals(1, fakeAuth.ensureAuthenticatedCallCount)
    }

    @Test
    @Config(sdk = [34])
    fun testAuthenticationFailureShowsErrorAndDoesNotComplete() {
        val fakeAuth = FakeAuthRepository(shouldSucceed = false)
        MainActivity.testAuthRepositoryOverride = fakeAuth

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertFalse(activity.isFinishing)
        assertFalse(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))

        val tvErrorMessage = activity.findViewById<TextView>(R.id.tvErrorMessage)
        val btnRetry = activity.findViewById<Button>(R.id.btnRetry)

        assertEquals(View.VISIBLE, tvErrorMessage.visibility)
        assertTrue(tvErrorMessage.text.contains("Authentication failed"))
        assertEquals(View.VISIBLE, btnRetry.visibility)
    }

    @Test
    @Config(sdk = [34])
    fun testRetryAfterAuthFailureCanSucceed() {
        val fakeAuth = FakeAuthRepository(shouldSucceed = false)
        MainActivity.testAuthRepositoryOverride = fakeAuth

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val btnRetry = activity.findViewById<Button>(R.id.btnRetry)
        assertEquals(View.VISIBLE, btnRetry.visibility)

        fakeAuth.shouldSucceed = true
        MainActivity.testNotificationPermissionChecker = { true }
        MainActivity.testStoragePermissionChecker = { true }

        btnRetry.performClick()
        ShadowLooper.idleMainLooper()

        assertTrue(activity.isFinishing)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))
    }

    @Test
    @Config(sdk = [33])
    fun testApi33NotificationPermissionPathWhenNotGranted() {
        val fakeAuth = FakeAuthRepository(shouldSucceed = true)
        MainActivity.testAuthRepositoryOverride = fakeAuth
        MainActivity.testNotificationPermissionChecker = { false }
        MainActivity.testStoragePermissionChecker = { true }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertFalse(activity.isFinishing)

        activity.onRequestPermissionsResult(
            MainActivity.REQUEST_CODE_NOTIFICATIONS,
            arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
            intArrayOf(android.content.pm.PackageManager.PERMISSION_GRANTED)
        )
        ShadowLooper.idleMainLooper()

        assertTrue(activity.isFinishing)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))
    }

    @Test
    @Config(sdk = [29])
    fun testApi29PathWithoutNotificationPermissionCompletesInSafMode() {
        val fakeAuth = FakeAuthRepository(shouldSucceed = true)
        MainActivity.testAuthRepositoryOverride = fakeAuth

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        ShadowLooper.idleMainLooper()

        assertTrue(activity.isFinishing)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))
        assertFalse(prefs.getBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true))
        assertEquals("SAF", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }

    @Test
    @Config(sdk = [34])
    fun testApi30ExternalStorageGrantedEnablesDirectFileMode() {
        val fakeAuth = FakeAuthRepository(shouldSucceed = true)
        MainActivity.testAuthRepositoryOverride = fakeAuth
        MainActivity.testNotificationPermissionChecker = { true }
        MainActivity.testStoragePermissionChecker = { true }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        ShadowLooper.idleMainLooper()

        assertTrue(activity.isFinishing)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))
        assertTrue(prefs.getBoolean(MainActivity.KEY_DIRECT_FILE_MODE, false))
        assertEquals("DIRECT_FILE", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }

    @Test
    @Config(sdk = [34])
    fun testApi30ExternalStorageMissingShowsPromptAndAllowsSafMode() {
        val fakeAuth = FakeAuthRepository(shouldSucceed = true)
        MainActivity.testAuthRepositoryOverride = fakeAuth
        MainActivity.testNotificationPermissionChecker = { true }
        MainActivity.testStoragePermissionChecker = { false }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        assertFalse(activity.isFinishing)
        assertFalse(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))

        val btnGrantStorage = activity.findViewById<Button>(R.id.btnGrantStorage)
        val btnContinueSaf = activity.findViewById<Button>(R.id.btnContinueSaf)

        assertEquals(View.VISIBLE, btnGrantStorage.visibility)
        assertEquals(View.VISIBLE, btnContinueSaf.visibility)

        btnContinueSaf.performClick()
        ShadowLooper.idleMainLooper()

        assertTrue(activity.isFinishing)
        assertTrue(prefs.getBoolean(MainActivity.KEY_SETUP_COMPLETE, false))
        assertFalse(prefs.getBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true))
        assertEquals("SAF", prefs.getString(MainActivity.KEY_STORAGE_MODE, null))
    }
}
