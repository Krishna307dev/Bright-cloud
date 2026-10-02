package com.usbcloudbackup.setup

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.annotation.VisibleForTesting
import androidx.core.content.ContextCompat
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.usbcloudbackup.R
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.auth.FirebaseAuthRepository
import com.usbcloudbackup.storage.SourceIdResolver
import com.usbcloudbackup.worker.BackupWorkManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

class MainActivity : Activity() {

    companion object {
        private const val TAG = "MainActivity"
        const val ACTION_RESUME_BACKUP = "com.usbcloudbackup.action.RESUME_BACKUP"
        const val PREFS_NAME = "usb_cloud_backup_setup"
        const val KEY_SETUP_COMPLETE = "setup_complete"
        const val KEY_DIRECT_FILE_MODE = "direct_file_mode"
        const val KEY_STORAGE_MODE = "storage_mode"

        const val REQUEST_CODE_NOTIFICATIONS = 101
        const val REQUEST_CODE_STORAGE_SETTINGS = 102
        const val REQUEST_CODE_SAF_TREE = 103

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testAuthRepositoryOverride: AuthRepository? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testStoragePermissionChecker: ((Context) -> Boolean)? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testNotificationPermissionChecker: ((Context) -> Boolean)? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testSafPickerLauncher: ((Activity) -> Unit)? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testHandoffTimeoutMs: Long = 2500L

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testMountWaitTimeoutMs: Long = 5000L

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testMountPollIntervalMs: Long = 250L
    }

    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var tvTitle: TextView? = null
    private var tvStatus: TextView? = null
    private var tvErrorMessage: TextView? = null
    private var progressBar: ProgressBar? = null
    private var btnGrantStorage: Button? = null
    private var btnContinueSaf: Button? = null
    private var btnRetry: Button? = null

    private var isAwaitingStorageSettings = false

    private var pendingMountJob: Job? = null
    private var isUsbDetachReceiverRegistered = false
    private var hasEnqueuedBackup = false

    private val usbDetachReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
                Log.i(TAG, "USB detached broadcast received. Cancelling pending mount wait and finishing.")
                cancelPendingMountWait("USB detached broadcast")
                finish()
            }
        }
    }

    private fun registerUsbDetachReceiver() {
        if (!isUsbDetachReceiverRegistered) {
            try {
                val filter = IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    registerReceiver(usbDetachReceiver, filter, Context.RECEIVER_EXPORTED)
                } else {
                    registerReceiver(usbDetachReceiver, filter)
                }
                isUsbDetachReceiverRegistered = true
            } catch (e: Exception) {
                Log.w(TAG, "Failed to register usbDetachReceiver: ${e.message}")
            }
        }
    }

    private fun unregisterUsbDetachReceiver() {
        if (isUsbDetachReceiverRegistered) {
            try {
                unregisterReceiver(usbDetachReceiver)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to unregister usbDetachReceiver: ${e.message}")
            } finally {
                isUsbDetachReceiverRegistered = false
            }
        }
    }

    private var mediaMountReceiver: BroadcastReceiver? = null

    private fun unregisterMediaMountReceiver() {
        mediaMountReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (_: Throwable) {}
            mediaMountReceiver = null
        }
    }

    private fun cancelPendingMountWait(reason: String) {
        if (pendingMountJob?.isActive == true) {
            Log.i(TAG, "Cancelling pending mount wait. Reason: $reason")
            pendingMountJob?.cancel()
            pendingMountJob = null
        }
        unregisterMediaMountReceiver()
    }

    @Synchronized
    private fun enqueueBackupAndHandoff(sourceId: String, hintDevice: UsbDevice? = null) {
        if (hasEnqueuedBackup || isFinishing || isDestroyed) {
            Log.d(TAG, "Backup already enqueued ($hasEnqueuedBackup) or Activity finishing/destroyed ($isFinishing/$isDestroyed), ignoring enqueue request.")
            return
        }
        hasEnqueuedBackup = true
        cancelPendingMountWait("Backup enqueued")
        Log.i(TAG, "Enqueueing backup for mounted canonical sourceId=$sourceId")
        val device = hintDevice ?: getUsbDeviceFromIntent(intent)
        BackupWorkManager.enqueueBackup(this, sourceId, device, androidx.work.ExistingWorkPolicy.KEEP)
        performForegroundHandoff(sourceId, device)
    }

    private fun startDelayedMountWait(intent: Intent?) {
        if (pendingMountJob?.isActive == true || hasEnqueuedBackup) {
            Log.d(TAG, "Mount wait already in progress or backup already enqueued. Ignoring.")
            return
        }
        setContentView(R.layout.activity_usb_handoff)
        registerUsbDetachReceiver()

        // Register dynamic receiver for ACTION_MEDIA_MOUNTED to wake immediately on mount
        val hintDevice = getUsbDeviceFromIntent(intent)
        val mountFilter = IntentFilter(Intent.ACTION_MEDIA_MOUNTED).apply {
            addDataScheme("file")
        }
        mediaMountReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, mountIntent: Intent?) {
                if (mountIntent?.action == Intent.ACTION_MEDIA_MOUNTED) {
                    Log.i(TAG, "Dynamic ACTION_MEDIA_MOUNTED received during mount wait.")
                    val canonical = SourceIdResolver.resolveMountedCanonicalSourceId(this@MainActivity, hintDevice)
                    if (canonical != null && !hasEnqueuedBackup && !isFinishing && !isDestroyed) {
                        enqueueBackupAndHandoff(canonical, hintDevice)
                    }
                }
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(mediaMountReceiver, mountFilter, Context.RECEIVER_EXPORTED)
            } else {
                registerReceiver(mediaMountReceiver, mountFilter)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed registering dynamic mediaMountReceiver: ${e.message}")
        }

        pendingMountJob = activityScope.launch {
            val timeoutMs = testMountWaitTimeoutMs
            val intervalMs = testMountPollIntervalMs
            var resolvedSourceId: String? = null

            Log.i(TAG, "Starting delayed mount wait for USB volume (timeout=${timeoutMs}ms, interval=${intervalMs}ms)...")

            try {
                withTimeoutOrNull(timeoutMs) {
                    while (isActive && !hasEnqueuedBackup) {
                        val currentDevice = hintDevice ?: getUsbDeviceFromIntent(getIntent())
                        val sourceId = SourceIdResolver.resolveMountedCanonicalSourceId(this@MainActivity, currentDevice)
                        if (sourceId != null) {
                            resolvedSourceId = sourceId
                            break
                        }
                        delay(intervalMs)
                        if (!isActive || isFinishing || isDestroyed) {
                            Log.d(TAG, "Activity no longer active during mount polling. Aborting.")
                            return@withTimeoutOrNull
                        }
                    }
                }

                if (!isActive || isFinishing || isDestroyed) {
                    Log.d(TAG, "Activity destroyed or finishing after mount polling. Aborting.")
                    return@launch
                }

                if (hasEnqueuedBackup) {
                    Log.d(TAG, "Backup already enqueued by mount trigger. Mount wait completed.")
                    return@launch
                }

                if (resolvedSourceId != null) {
                    Log.i(TAG, "Delayed mount wait resolved mounted sourceId=$resolvedSourceId. Enqueueing backup.")
                    enqueueBackupAndHandoff(resolvedSourceId, hintDevice)
                } else {
                    Log.w(TAG, "Delayed mount wait timed out after ${timeoutMs}ms with no mounted USB volume. Finishing cleanly without enqueuing backup.")
                    finish()
                }
            } finally {
                unregisterMediaMountReceiver()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val isUsbAttach = intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED
        val isResume = intent?.action == ACTION_RESUME_BACKUP
        val sourceIdFromIntent = resolveSourceIdFromIntent(intent)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_SETUP_COMPLETE, false)) {
            if (isUsbAttach || isResume) {
                if (sourceIdFromIntent != null) {
                    Log.i(TAG, "USB attach or resume intent received after setup complete. Mounted sourceId resolved: $sourceIdFromIntent")
                    enqueueBackupAndHandoff(sourceIdFromIntent, getUsbDeviceFromIntent(intent))
                    return
                } else {
                    Log.i(TAG, "USB attach or resume intent received after setup complete, but storage is not mounted yet. Starting delayed mount wait.")
                    startDelayedMountWait(intent)
                    return
                }
            }
            Log.i(TAG, "Setup already completed. Finishing MainActivity.")
            finish()
            return
        }

        setContentView(R.layout.activity_main)
        initViews()
        startSetup()
    }

    public override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)

        if (intent?.action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
            Log.i(TAG, "onNewIntent: USB detached received. Cancelling pending mount wait and finishing.")
            cancelPendingMountWait("USB detached in onNewIntent")
            finish()
            return
        }

        val isUsbAttach = intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED
        val isResume = intent?.action == ACTION_RESUME_BACKUP
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        if (prefs.getBoolean(KEY_SETUP_COMPLETE, false) && (isUsbAttach || isResume)) {
            if (hasEnqueuedBackup) {
                Log.d(TAG, "onNewIntent: Backup already enqueued for this session, ignoring duplicate intent.")
                return
            }
            val sourceIdFromIntent = resolveSourceIdFromIntent(intent)
            if (sourceIdFromIntent != null) {
                Log.i(TAG, "onNewIntent: USB attach or resume received after setup complete. Immediate sourceId: $sourceIdFromIntent")
                enqueueBackupAndHandoff(sourceIdFromIntent, getUsbDeviceFromIntent(intent))
            } else if (pendingMountJob?.isActive != true) {
                Log.i(TAG, "onNewIntent: USB attach received but immediate sourceId is null. Starting delayed mount wait.")
                startDelayedMountWait(intent)
            } else {
                Log.d(TAG, "onNewIntent: Mount wait already in progress, ignoring duplicate intent.")
            }
        }
    }

    private fun performForegroundHandoff(sourceId: String, hintDevice: UsbDevice? = null) {
        setContentView(R.layout.activity_usb_handoff)

        activityScope.launch {
            val uniqueWorkName = BackupWorkManager.getUniqueWorkName(this@MainActivity, sourceId, hintDevice)
            withTimeoutOrNull(testHandoffTimeoutMs) {
                try {
                    WorkManager.getInstance(applicationContext)
                        .getWorkInfosForUniqueWorkFlow(uniqueWorkName)
                        .firstOrNull { list -> list.any { it.state == WorkInfo.State.RUNNING } }
                } catch (_: Throwable) {
                    delay(500L)
                }
            }
            Log.i(TAG, "Foreground handoff completed. Finishing MainActivity.")
            finish()
        }
    }

    @Suppress("DEPRECATION")
    private fun getUsbDeviceFromIntent(intent: Intent?): UsbDevice? {
        if (intent == null) return null
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        } else {
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        }
    }

    private fun resolveSourceIdFromIntent(intent: Intent?): String? {
        val device = getUsbDeviceFromIntent(intent)
        return SourceIdResolver.resolveMountedCanonicalSourceId(this, device)
    }

    private fun launchSafPicker() {
        testSafPickerLauncher?.let {
            it.invoke(this)
            return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        }
        try {
            startActivityForResult(intent, REQUEST_CODE_SAF_TREE)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch SAF directory picker: ${e.message}", e)
            showError("Could not open system file picker for SAF mode.")
        }
    }

    private fun initViews() {
        tvTitle = findViewById(R.id.tvTitle)
        tvStatus = findViewById(R.id.tvStatus)
        tvErrorMessage = findViewById(R.id.tvErrorMessage)
        progressBar = findViewById(R.id.progressBar)
        btnGrantStorage = findViewById(R.id.btnGrantStorage)
        btnContinueSaf = findViewById(R.id.btnContinueSaf)
        btnRetry = findViewById(R.id.btnRetry)

        btnGrantStorage?.setOnClickListener {
            launchStorageSettings()
        }

        btnContinueSaf?.setOnClickListener {
            Log.i(TAG, "User opted for SAF mode. Launching folder picker.")
            launchSafPicker()
            if (Build.FINGERPRINT == "robolectric") {
                completeSetup(directFileMode = false)
            }
        }

        btnRetry?.setOnClickListener {
            startSetup()
        }
    }

    private fun startSetup() {
        showProgress("Authenticating upload daemon with Firebase...")
        hideError()
        btnGrantStorage?.visibility = View.GONE
        btnContinueSaf?.visibility = View.GONE

        activityScope.launch {
            try {
                val authRepo = testAuthRepositoryOverride ?: FirebaseAuthRepository()
                val uid = authRepo.ensureAuthenticated()
                Log.i(TAG, "Authenticated upload daemon successfully: $uid")
                onAuthSuccess()
            } catch (e: Exception) {
                Log.e(TAG, "Authentication failed: ${e.message}", e)
                showError("Authentication failed: ${e.message ?: "Network or service error"}")
            }
        }
    }

    private fun onAuthSuccess() {
        checkNotificationPermission()
    }

    private fun checkNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val isGranted = testNotificationPermissionChecker?.invoke(this)
                ?: (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

            if (!isGranted) {
                showProgress("Requesting notification permission...")
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE_NOTIFICATIONS)
                return
            }
        }
        checkStoragePermission()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        if (requestCode == REQUEST_CODE_NOTIFICATIONS) {
            Log.i(TAG, "Notification permission result received.")
            checkStoragePermission()
            return
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    private fun checkStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val isManager = testStoragePermissionChecker?.invoke(this)
                ?: Environment.isExternalStorageManager()

            if (isManager) {
                Log.i(TAG, "MANAGE_EXTERNAL_STORAGE is granted. Enabling Direct File mode.")
                completeSetup(directFileMode = true)
            } else {
                showStoragePermissionPrompt()
            }
        } else {
            // Android 10 (API 29) uses SAF fallback mode
            Log.i(TAG, "Android API 29 detected. Defaulting to SAF mode.")
            completeSetup(directFileMode = false)
        }
    }

    private fun showStoragePermissionPrompt() {
        progressBar?.visibility = View.GONE
        tvStatus?.text = "Storage access is required to automatically back up USB drives. Grant all-files access for high-speed scanning, or continue in SAF mode."
        btnGrantStorage?.visibility = View.VISIBLE
        btnContinueSaf?.visibility = View.VISIBLE
    }

    private fun launchStorageSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            isAwaitingStorageSettings = true
            try {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivityForResult(intent, REQUEST_CODE_STORAGE_SETTINGS)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to launch package-specific storage settings, falling back to generic settings: ${e.message}")
                try {
                    val fallbackIntent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                    startActivityForResult(fallbackIntent, REQUEST_CODE_STORAGE_SETTINGS)
                } catch (e2: Exception) {
                    Log.e(TAG, "Failed to launch all-files settings: ${e2.message}", e2)
                    showError("Could not open system settings. You can continue with SAF mode.")
                    btnContinueSaf?.visibility = View.VISIBLE
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (isAwaitingStorageSettings && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            isAwaitingStorageSettings = false
            val isManager = testStoragePermissionChecker?.invoke(this)
                ?: Environment.isExternalStorageManager()

            if (isManager) {
                Log.i(TAG, "Returned from Settings: MANAGE_EXTERNAL_STORAGE granted.")
                completeSetup(directFileMode = true)
            } else {
                Log.i(TAG, "Returned from Settings: MANAGE_EXTERNAL_STORAGE not granted.")
                showStoragePermissionPrompt()
            }
        }
    }

    public override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_STORAGE_SETTINGS && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            isAwaitingStorageSettings = false
            val isManager = testStoragePermissionChecker?.invoke(this)
                ?: Environment.isExternalStorageManager()

            if (isManager) {
                Log.i(TAG, "onActivityResult: MANAGE_EXTERNAL_STORAGE granted.")
                completeSetup(directFileMode = true)
            } else {
                Log.i(TAG, "onActivityResult: MANAGE_EXTERNAL_STORAGE not granted.")
                showStoragePermissionPrompt()
            }
            return
        }

        if (requestCode == REQUEST_CODE_SAF_TREE) {
            if (resultCode == RESULT_OK && data?.data != null) {
                val treeUri = data.data!!
                val takeFlags = (data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
                    .let { if (it != 0) it else Intent.FLAG_GRANT_READ_URI_PERMISSION }
                try {
                    contentResolver.takePersistableUriPermission(treeUri, takeFlags)
                    Log.i(TAG, "Persisted SAF tree URI permission: $treeUri")
                    completeSetup(directFileMode = false)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to take read/write permission for $treeUri: ${e.message}. Trying read-only.")
                    try {
                        contentResolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        completeSetup(directFileMode = false)
                    } catch (e2: Exception) {
                        Log.e(TAG, "Failed to take read-only permission for $treeUri: ${e2.message}", e2)
                        showError("Failed to retain permission for selected folder.")
                    }
                }
            } else {
                Log.w(TAG, "SAF directory picker cancelled or returned null data.")
                showStoragePermissionPrompt()
            }
            return
        }
    }

    private fun completeSetup(directFileMode: Boolean) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(KEY_SETUP_COMPLETE, true)
            .putBoolean(KEY_DIRECT_FILE_MODE, directFileMode)
            .putString(KEY_STORAGE_MODE, if (directFileMode) "DIRECT_FILE" else "SAF")
            .apply()

        val attachedDevice = getUsbDeviceFromIntent(intent)
        val enqueued = BackupWorkManager.enqueueBackupIfReady(this, attachedDevice)
        if (enqueued) {
            Log.i(TAG, "Setup completed with mounted attached USB. Backup enqueued.")
        } else {
            Log.i(TAG, "Setup completed. USB volume is not mounted or not readable yet. Deferring backup to mount lifecycle.")
        }

        tvTitle?.text = "Daemon Active"
        tvStatus?.text = "Upload daemon is ready.\nPlug in a USB drive to start automatic backup."
        progressBar?.visibility = View.GONE
        btnGrantStorage?.visibility = View.GONE
        btnContinueSaf?.visibility = View.GONE
        btnRetry?.visibility = View.GONE
        tvErrorMessage?.visibility = View.GONE

        Log.i(TAG, "Setup completed successfully (directFileMode=$directFileMode). Finishing Activity.")
        finish()
    }

    private fun showProgress(message: String) {
        progressBar?.visibility = View.VISIBLE
        tvStatus?.text = message
    }

    private fun showError(message: String) {
        progressBar?.visibility = View.GONE
        tvErrorMessage?.text = message
        tvErrorMessage?.visibility = View.VISIBLE
        btnRetry?.visibility = View.VISIBLE
    }

    private fun hideError() {
        tvErrorMessage?.visibility = View.GONE
        btnRetry?.visibility = View.GONE
    }

    override fun onDestroy() {
        super.onDestroy()
        cancelPendingMountWait("Activity destroyed")
        unregisterUsbDetachReceiver()
        activityScope.cancel()
    }
}
