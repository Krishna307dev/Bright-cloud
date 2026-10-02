package com.usbcloudbackup.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import com.usbcloudbackup.worker.BackupWorkManager
import java.security.MessageDigest

class UsbEventReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "UsbEventReceiver"

        /**
         * Resolves the canonical, deterministic sourceId for a physical USB storage drive.
         *
         * Hierarchy:
         * 1. Primary: Filesystem partition volume UUID (e.g. "8F12-3456" from FAT32/exFAT).
         * 2. Supplemental: USB hardware serial number descriptor.
         * 3. Fallback: Deterministic SHA-256 hash of USB manufacturer + product descriptors.
         */
        fun computeSourceId(volumeUuid: String?, device: UsbDevice?): String {
            return com.usbcloudbackup.storage.SourceIdResolver.computeSourceId(volumeUuid, device)
        }

        fun generateSourceId(device: UsbDevice): String {
            return com.usbcloudbackup.storage.SourceIdResolver.computeSourceId(null, device)
        }

        fun isMassStorageDevice(device: UsbDevice): Boolean {
            return com.usbcloudbackup.storage.SourceIdResolver.isMassStorage(device)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.i(TAG, "USB Event broadcast received. action=$action")

        if (action == UsbManager.ACTION_USB_DEVICE_ATTACHED) {
            val device: UsbDevice? = getUsbDeviceFromIntent(intent)
            if (device == null) {
                Log.w(TAG, "USB_DEVICE_ATTACHED intent received but EXTRA_DEVICE is null.")
                return
            }

            val isMassStorage = isMassStorageDevice(device)
            Log.i(TAG, "USB Device Attached: vendorId=${device.vendorId}, productId=${device.productId}, isMassStorage=$isMassStorage")

            if (isMassStorage) {
                val enqueued = BackupWorkManager.enqueueBackupIfReady(context, device)
                if (!enqueued) {
                    Log.i(TAG, "USB device attached, but storage volume is not mounted yet. Awaiting ACTION_MEDIA_MOUNTED or mount callback.")
                }
            } else {
                Log.d(TAG, "USB device attached is not a Mass Storage device (Interface Class 8). Ignoring.")
            }
        } else if (action == Intent.ACTION_MEDIA_MOUNTED) {
            val mountUri = intent.data
            Log.i(TAG, "ACTION_MEDIA_MOUNTED broadcast received. mountUri=$mountUri")
            val prefs = context.getSharedPreferences(com.usbcloudbackup.setup.MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            if (prefs.getBoolean(com.usbcloudbackup.setup.MainActivity.KEY_SETUP_COMPLETE, false)) {
                val enqueued = BackupWorkManager.enqueueBackupIfReady(context)
                if (enqueued) {
                    Log.i(TAG, "ACTION_MEDIA_MOUNTED: Backup work successfully enqueued after volume mount.")
                } else {
                    Log.d(TAG, "ACTION_MEDIA_MOUNTED: Storage volume not ready for enqueue.")
                }
            } else {
                Log.d(TAG, "ACTION_MEDIA_MOUNTED: Setup not completed yet, skipping auto-backup.")
            }
        } else if (action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
            val device: UsbDevice? = getUsbDeviceFromIntent(intent)
            val sourceId = device?.let {
                com.usbcloudbackup.storage.SourceIdResolver.resolveCanonicalSourceId(context, it)
                    ?: com.usbcloudbackup.storage.SourceIdResolver.computeSourceId(null, it)
            } ?: "unknown"
            Log.i(TAG, "USB Device Detached: sourceId=$sourceId")
            if (sourceId != "unknown") {
                BackupWorkManager.cancelBackup(context, sourceId, device)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun getUsbDeviceFromIntent(intent: Intent): UsbDevice? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        } else {
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        }
    }
}
