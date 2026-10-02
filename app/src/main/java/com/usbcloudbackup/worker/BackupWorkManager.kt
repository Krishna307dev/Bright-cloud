package com.usbcloudbackup.worker

import android.content.Context
import android.hardware.usb.UsbDevice
import android.util.Log
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.usbcloudbackup.storage.SourceIdResolver
import java.util.concurrent.TimeUnit

object BackupWorkManager {

    private const val TAG = "BackupWorkManager"

    const val KEY_SOURCE_ID = "KEY_SOURCE_ID"
    const val UNIQUE_RECONCILIATION_WORK = "reconciliation_work"

    fun getUniqueWorkName(sourceId: String): String = getUniqueWorkName(null, sourceId, null)

    fun getUniqueWorkName(context: Context?, sourceId: String, hintDevice: UsbDevice? = null): String {
        val workKey = SourceIdResolver.resolveWorkKey(context, sourceId, hintDevice)
        return "backup_$workKey"
    }

    fun enqueueBackupIfReady(context: Context, hintDevice: UsbDevice? = null): Boolean {
        val canonicalSourceId = SourceIdResolver.resolveMountedCanonicalSourceId(context, hintDevice)
        if (canonicalSourceId == null) {
            Log.d(TAG, "Storage volume is not mounted and readable. Skipping enqueue.")
            return false
        }
        Log.i(TAG, "Storage volume ready (canonicalSourceId=$canonicalSourceId). Enqueueing unique backup work with KEEP policy.")
        enqueueBackup(context, canonicalSourceId, hintDevice, ExistingWorkPolicy.KEEP)
        return true
    }

    fun enqueueBackup(
        context: Context,
        sourceId: String,
        hintDevice: UsbDevice? = null,
        existingWorkPolicy: ExistingWorkPolicy = ExistingWorkPolicy.KEEP
    ) {
        val canonicalSourceId = SourceIdResolver.canonicalizeSourceId(context, sourceId, hintDevice) ?: sourceId
        val uniqueWorkName = getUniqueWorkName(context, canonicalSourceId, hintDevice)
        Log.i(TAG, "Enqueueing unique backup work for canonicalSourceId=$canonicalSourceId (raw=$sourceId), uniqueWorkName=$uniqueWorkName, policy=$existingWorkPolicy")

        val inputData = Data.Builder()
            .putString(KEY_SOURCE_ID, canonicalSourceId)
            .build()

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val backupWorkRequest = OneTimeWorkRequestBuilder<BackupWorker>()
            .setInputData(inputData)
            .setConstraints(constraints)
            .addTag("backup_worker")
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            uniqueWorkName,
            existingWorkPolicy,
            backupWorkRequest
        )
    }

    fun cancelBackup(context: Context, sourceId: String, hintDevice: UsbDevice? = null) {
        val uniqueWorkName = getUniqueWorkName(context, sourceId, hintDevice)
        Log.i(TAG, "Cancelling unique backup work for sourceId=$sourceId ($uniqueWorkName)")
        WorkManager.getInstance(context).cancelUniqueWork(uniqueWorkName)
    }

    fun enqueueReconciliation(context: Context) {
        Log.i(TAG, "Enqueueing durable reconciliation work.")

        val oneTimeReconciliationRequest = OneTimeWorkRequestBuilder<ReconciliationWorker>()
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "onetime_reconciliation",
            ExistingWorkPolicy.KEEP,
            oneTimeReconciliationRequest
        )

        val periodicRequest = PeriodicWorkRequestBuilder<ReconciliationWorker>(6, TimeUnit.HOURS)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_RECONCILIATION_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            periodicRequest
        )
    }
}
