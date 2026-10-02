package com.usbcloudbackup.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.usbcloudbackup.worker.BackupWorkManager

class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            Log.i(TAG, "Lifecycle restart broadcast received: $action. Enqueueing durable boot reconciliation work.")
            BackupWorkManager.enqueueReconciliation(context)
        }
    }
}
