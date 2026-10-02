package com.usbcloudbackup.worker

import android.content.Context
import android.util.Log
import androidx.annotation.VisibleForTesting
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.auth.FirebaseAuthRepository
import com.usbcloudbackup.cloud.firestore.FirebaseFirestoreRepository
import com.usbcloudbackup.cloud.firestore.FirestoreRepository
import com.usbcloudbackup.cloud.recovery.CloudRecoveryEngine
import com.usbcloudbackup.cloud.storage.CloudStorageRepository
import com.usbcloudbackup.cloud.storage.b2.BackblazeB2StorageRepository
import com.usbcloudbackup.cloud.storage.b2.DefaultB2AuthorizationProvider
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.database.AppDatabase
import java.io.ByteArrayInputStream
import kotlinx.coroutines.CancellationException

class ReconciliationWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "ReconciliationWorker"

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testAuthRepositoryOverride: AuthRepository? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testFirestoreRepositoryOverride: FirestoreRepository? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testCloudStorageRepositoryOverride: CloudStorageRepository? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testPendingDeletionStoreOverride: com.usbcloudbackup.cloud.storage.b2.IPendingDeletionStore? = null
    }

    override suspend fun doWork(): Result {
        Log.i(TAG, "Starting ReconciliationWorker execution. runAttemptCount=$runAttemptCount")

        val database = AppDatabase.getInstance(applicationContext)
        val fileRepo = FileRepository(database.fileDao())
        val jobRepo = BackupJobRepository(database.backupJobDao())
        val uploadRepo = UploadRepository(database.uploadTaskDao())

        val authRepo = testAuthRepositoryOverride ?: FirebaseAuthRepository()
        val firestoreRepo = testFirestoreRepositoryOverride ?: FirebaseFirestoreRepository()
        val storageRepo = testCloudStorageRepositoryOverride ?: BackblazeB2StorageRepository(
            authorizationProvider = DefaultB2AuthorizationProvider(
                idTokenProvider = { authRepo.getIdToken() }
            )
        )
        val pendingDeletionStore = testPendingDeletionStoreOverride
            ?: com.usbcloudbackup.cloud.storage.b2.PendingDeletionStore.getInstance(applicationContext)

        val recoveryEngine = CloudRecoveryEngine(
            fileRepository = fileRepo,
            jobRepository = jobRepo,
            uploadRepository = uploadRepo,
            firestoreRepository = firestoreRepo,
            cloudStorageRepository = storageRepo,
            pendingDeletionStore = pendingDeletionStore
        )

        return try {
            authRepo.ensureAuthenticated()
            val vaultId = VaultConfig.DEFAULT_VAULT_ID

            // Drain any pending redundant B2 deletions
            drainPendingDeletions(pendingDeletionStore, storageRepo)

            // Query Room for tasks in UPLOADED_NOT_INDEXED state
            val unfinishedTasks = uploadRepo.getUnfinishedTasks()
            val uploadedNotIndexedTasks = unfinishedTasks.filter { it.state == UploadTaskState.UPLOADED_NOT_INDEXED }

            Log.i(TAG, "Reconciliation scan found ${uploadedNotIndexedTasks.size} tasks in UPLOADED_NOT_INDEXED state.")

            for (task in uploadedNotIndexedTasks) {
                if (isStopped) return Result.failure()

                val file = fileRepo.getFile(task.fileId) ?: continue
                Log.i(TAG, "Reconciling UPLOADED_NOT_INDEXED file fileId=${file.id}, originalName=${file.originalName}")

                try {
                    recoveryEngine.processOrRecoverUpload(
                        vaultId = vaultId,
                        file = file,
                        task = task,
                        inputStreamProvider = { ByteArrayInputStream(ByteArray(0)) }
                    )
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Failed reconciling task ${task.taskId}.", e)
                }
            }

            // Query Room for tasks in UPLOADING state interrupted during transfer
            val uploadingTasks = unfinishedTasks.filter { it.state == UploadTaskState.UPLOADING }
            Log.i(TAG, "Reconciliation scan found ${uploadingTasks.size} tasks in UPLOADING state.")

            for (task in uploadingTasks) {
                if (isStopped) return Result.failure()

                val file = fileRepo.getFile(task.fileId) ?: continue
                try {
                    val meta = storageRepo.checkObjectExists(task.b2ObjectKey)
                    if (meta != null && meta.size == file.size &&
                        (file.sha256.isNullOrBlank() || meta.sha256.isNullOrBlank() || meta.sha256.equals(file.sha256, ignoreCase = true))
                    ) {
                        Log.i(TAG, "Reconciliation verified completed upload for interrupted task ${task.taskId}, promoting to UPLOADED_NOT_INDEXED.")
                        uploadRepo.updateTaskState(task.taskId, UploadTaskState.UPLOADED_NOT_INDEXED)
                        fileRepo.updateFileStatus(file.id, com.usbcloudbackup.backup.model.FileStatus.UPLOADED_NOT_INDEXED)
                        val updatedTask = uploadRepo.getTask(task.taskId) ?: task
                        val updatedFile = fileRepo.getFile(file.id) ?: file
                        recoveryEngine.processOrRecoverUpload(
                            vaultId = vaultId,
                            file = updatedFile,
                            task = updatedTask,
                            inputStreamProvider = { ByteArrayInputStream(ByteArray(0)) }
                        )
                    } else {
                        Log.i(TAG, "Interrupted UPLOADING task ${task.taskId} not complete on B2. Resetting file to SOURCE_UNAVAILABLE for next USB backup run.")
                        fileRepo.updateFileStatus(file.id, com.usbcloudbackup.backup.model.FileStatus.SOURCE_UNAVAILABLE, "Interrupted upload")
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Failed checking B2 for interrupted UPLOADING task ${task.taskId}.", e)
                }
            }

            // Boot reconciliation only initiates backup if a removable storage volume is actually mounted and readable.
            val usbManager = applicationContext.getSystemService(Context.USB_SERVICE) as? android.hardware.usb.UsbManager
            val massStorageDevices = usbManager?.deviceList?.values?.filter {
                com.usbcloudbackup.storage.SourceIdResolver.isMassStorage(it)
            } ?: emptyList()

            if (massStorageDevices.isNotEmpty()) {
                for (device in massStorageDevices) {
                    val enqueued = BackupWorkManager.enqueueBackupIfReady(applicationContext, device)
                    if (enqueued) {
                        Log.i(TAG, "Boot reconciliation enqueued backup for mounted USB mass storage device (${device.deviceName}).")
                    } else {
                        Log.d(TAG, "Boot reconciliation found USB mass storage device (${device.deviceName}) but volume is not mounted/readable yet. Skipping backup enqueue.")
                    }
                }
            } else {
                val enqueued = BackupWorkManager.enqueueBackupIfReady(applicationContext)
                if (enqueued) {
                    Log.i(TAG, "Boot reconciliation enqueued backup for mounted removable storage volume.")
                } else {
                    Log.d(TAG, "Boot reconciliation: No mounted readable removable storage volume found. Skipping backup enqueue.")
                }
            }

            Result.success()

        } catch (e: CancellationException) {
            Log.i(TAG, "ReconciliationWorker coroutine cancelled.")
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Error during ReconciliationWorker execution.", e)
            Result.retry()
        }
    }

    private suspend fun drainPendingDeletions(
        pendingDeletionStore: com.usbcloudbackup.cloud.storage.b2.IPendingDeletionStore,
        storageRepo: CloudStorageRepository
    ) {
        try {
            val pending = pendingDeletionStore.getPendingDeletions()
            if (pending.isNotEmpty()) {
                Log.i(TAG, "Draining ${pending.size} pending B2 deletions during reconciliation.")
                for (key in pending) {
                    if (isStopped) break
                    try {
                        val deleted = storageRepo.deleteObject(key)
                        if (deleted) {
                            pendingDeletionStore.removePendingDeletion(key)
                            Log.i(TAG, "Successfully deleted pending B2 object: $key")
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed deleting pending B2 object $key: ${e.message}")
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Error while draining pending B2 deletions: ${e.message}")
        }
    }
}
