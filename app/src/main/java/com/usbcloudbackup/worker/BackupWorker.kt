package com.usbcloudbackup.worker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import androidx.annotation.VisibleForTesting
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.Job
import com.usbcloudbackup.backup.DeduplicationEngine
import com.usbcloudbackup.backup.DeduplicationResult
import com.usbcloudbackup.backup.VersionedNameResolver
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.SourceRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.auth.FirebaseAuthRepository
import com.usbcloudbackup.cloud.firestore.FirebaseFirestoreRepository
import com.usbcloudbackup.cloud.firestore.FirestoreRepository
import com.usbcloudbackup.cloud.recovery.CloudRecoveryEngine
import com.usbcloudbackup.cloud.storage.CloudStorageRepository
import com.usbcloudbackup.cloud.storage.b2.BackblazeB2StorageRepository
import com.usbcloudbackup.cloud.storage.b2.DefaultB2AuthorizationProvider
import com.usbcloudbackup.cloud.storage.b2.IPendingDeletionStore
import com.usbcloudbackup.cloud.storage.b2.PendingDeletionStore
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.hashing.Sha256Calculator
import com.usbcloudbackup.policy.BackupMode
import com.usbcloudbackup.scanning.FileScanner
import com.usbcloudbackup.storage.DirectFileStorageSource
import com.usbcloudbackup.storage.StorageSourceFactory
import com.usbcloudbackup.storage.UsbStorageSource
import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CancellationException

class BackupWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "BackupWorker"
        private const val NOTIFICATION_ID = 1001
        private const val NOTIFICATION_ID_PAUSED = 1002
        private const val CHANNEL_ID = "usb_cloud_backup_channel"

        const val FGS_BUDGET_MS = 5 * 3600_000L + 30 * 60_000L // 5.5 hours (leaves safe margin before Android 15 6h dataSync limit)
        const val DEGRADED_BUDGET_MS = 8 * 60_000L + 30_000L   // 8.5 minutes (leaves safe margin before JobScheduler 10m limit)

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testExecutionBudgetMs: Long? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testPendingDeletionStoreOverride: IPendingDeletionStore? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testStorageSourceProvider: ((String) -> UsbStorageSource)? = null

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
        var testSetForegroundOverride: (suspend (ForegroundInfo) -> Unit)? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testMountWaitTimeoutMs: Long? = null

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testMountPollIntervalMs: Long? = null
    }

    override suspend fun doWork(): Result {
        val rawSourceId = inputData.getString(BackupWorkManager.KEY_SOURCE_ID)
        if (rawSourceId == null || rawSourceId.isBlank()) {
            Log.e(TAG, "BackupWorker failed: KEY_SOURCE_ID missing from input data.")
            return Result.failure()
        }
        val canonicalSourceId = com.usbcloudbackup.storage.SourceIdResolver.resolveMountedCanonicalSourceId(applicationContext)
        var sourceId: String = com.usbcloudbackup.storage.SourceIdResolver.preferSpecificSourceId(rawSourceId, canonicalSourceId)
        val vaultId = VaultConfig.DEFAULT_VAULT_ID

        Log.i(TAG, "Starting BackupWorker execution for vaultId=$vaultId, sourceId=$sourceId (rawSourceId=$rawSourceId), runAttemptCount=$runAttemptCount")

        val startTime = System.currentTimeMillis()
        val isForeground = promoteToForegroundIfPossible()
        val executionBudgetMs = testExecutionBudgetMs ?: if (isForeground) FGS_BUDGET_MS else DEGRADED_BUDGET_MS
        Log.i(TAG, "BackupWorker execution mode: isForeground=$isForeground, executionBudgetMs=$executionBudgetMs")

        val database = AppDatabase.getInstance(applicationContext)
        val sourceRepo = SourceRepository(database.sourceDao())
        val fileRepo = FileRepository(database.fileDao())
        val jobRepo = BackupJobRepository(database.backupJobDao())
        val reservationRepo = ReservationRepository(database.nameReservationDao())
        val uploadRepo = UploadRepository(database.uploadTaskDao())

        val authRepo = testAuthRepositoryOverride ?: FirebaseAuthRepository()
        val firestoreRepo = testFirestoreRepositoryOverride ?: FirebaseFirestoreRepository()
        val storageRepo = testCloudStorageRepositoryOverride ?: BackblazeB2StorageRepository(
            authorizationProvider = DefaultB2AuthorizationProvider(
                idTokenProvider = { authRepo.getIdToken() }
            )
        )
        val pendingDeletionStore = testPendingDeletionStoreOverride
            ?: PendingDeletionStore.getInstance(applicationContext)

        val recoveryEngine = CloudRecoveryEngine(
            fileRepository = fileRepo,
            jobRepository = jobRepo,
            uploadRepository = uploadRepo,
            firestoreRepository = firestoreRepo,
            cloudStorageRepository = storageRepo,
            reservationRepository = reservationRepo,
            pendingDeletionStore = pendingDeletionStore
        )

        val deduplicationEngine = DeduplicationEngine(fileRepo, jobRepo)
        val nameResolver = VersionedNameResolver(database, fileRepo, reservationRepo, uploadRepo, jobRepo)
        val scanner = FileScanner(fileRepo, jobRepo)

        var currentJobId = ""

        val workerJob = kotlin.coroutines.coroutineContext[Job]
        val detachReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
                    Log.w(TAG, "ACTION_USB_DEVICE_DETACHED received in BackupWorker for source $sourceId. Preempting work.")
                    workerJob?.cancel(CancellationException("USB device detached"))
                    BackupWorkManager.cancelBackup(applicationContext, sourceId)
                }
            }
        }
        val detachFilter = IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED)
        ContextCompat.registerReceiver(
            applicationContext,
            detachReceiver,
            detachFilter,
            ContextCompat.RECEIVER_EXPORTED
        )

        try {
            // Step 1: Ensure Anonymous Device Authentication
            authRepo.ensureAuthenticated()

            // Drain any pending redundant B2 deletions from previous runs/races
            drainPendingDeletions(pendingDeletionStore, storageRepo)

            // Step 2: Obtain Storage Source Abstraction
            var storageSource: UsbStorageSource = testStorageSourceProvider?.invoke(sourceId)
                ?: StorageSourceFactory(applicationContext).createStorageSource(sourceId)

            if (!storageSource.isAvailable()) {
                val isAttached = com.usbcloudbackup.storage.SourceIdResolver.isPhysicalUsbAttached(applicationContext, sourceId)
                if (!isAttached) {
                    Log.w(TAG, "Storage source $sourceId physical device is detached. Aborting cleanly without retry.")
                    return Result.failure()
                }

                // Device is physically connected, but mount is not ready yet.
                // Perform bounded readiness wait inside worker before deciding whether to retry.
                val waitBudgetMs = testMountWaitTimeoutMs ?: 15_000L
                val pollIntervalMs = testMountPollIntervalMs ?: 500L
                val waitStart = System.currentTimeMillis()
                var readyStorage: UsbStorageSource? = null

                Log.i(TAG, "Storage source $sourceId is physically connected but volume not yet mounted/readable. Waiting for mount readiness (budget=${waitBudgetMs}ms)...")

                while (System.currentTimeMillis() - waitStart < waitBudgetMs && !isStopped) {
                    kotlinx.coroutines.delay(pollIntervalMs)
                    if (isStopped) break

                    val mountedCanonical = com.usbcloudbackup.storage.SourceIdResolver.resolveMountedCanonicalSourceId(applicationContext)
                    sourceId = com.usbcloudbackup.storage.SourceIdResolver.preferSpecificSourceId(sourceId, mountedCanonical)

                    val candidate = testStorageSourceProvider?.invoke(sourceId)
                        ?: StorageSourceFactory(applicationContext).createStorageSource(sourceId)
                    if (candidate.isAvailable()) {
                        readyStorage = candidate
                        break
                    }
                }

                if (readyStorage != null && readyStorage.isAvailable()) {
                    Log.i(TAG, "Storage source $sourceId became ready during bounded worker wait.")
                    storageSource = readyStorage
                } else if (!isStopped && com.usbcloudbackup.storage.SourceIdResolver.isPhysicalUsbAttached(applicationContext, sourceId)) {
                    Log.w(TAG, "Storage source $sourceId is physically attached but mount not ready after bounded wait. Returning Result.retry().")
                    return Result.retry()
                } else {
                    Log.w(TAG, "Storage source $sourceId is detached or worker stopped. Aborting cleanly.")
                    return Result.failure()
                }
            }

            // Step 3: Find or Create Source & BackupJob
            val source = sourceRepo.getSource(sourceId)?.also { existing ->
                try {
                    val updated = existing.copy(
                        lastSeen = System.currentTimeMillis(),
                        displayName = storageSource.displayName
                    )
                    firestoreRepo.saveSource(vaultId, updated)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to sync source lastSeen to Firestore for $sourceId: ${e.message}")
                }
            } ?: run {
                val parsed = com.usbcloudbackup.storage.SourceIdResolver.parseSourceComponents(sourceId, applicationContext)
                val newSource = UsbSource(
                    sourceId = sourceId,
                    usbVendorId = parsed.vendorId,
                    usbProductId = parsed.productId,
                    serialNumber = parsed.serialNumber,
                    volumeUuid = parsed.volumeUuid,
                    displayName = storageSource.displayName,
                    firstSeen = System.currentTimeMillis(),
                    lastSeen = System.currentTimeMillis()
                )
                sourceRepo.saveSource(newSource)
                try {
                    firestoreRepo.saveSource(vaultId, newSource)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to sync new source to Firestore for $sourceId: ${e.message}")
                }
                newSource
            }

            val activeFileStatuses = setOf(
                FileStatus.DISCOVERED,
                FileStatus.HASHING,
                FileStatus.HASHED,
                FileStatus.NAME_RESERVING,
                FileStatus.NAME_RESERVED,
                FileStatus.UPLOADING,
                FileStatus.UPLOADED_NOT_INDEXED,
                FileStatus.SOURCE_UNAVAILABLE
            )

            // Step 3b: Evaluate existing incomplete jobs for this source
            val incompleteJobs = jobRepo.getIncompleteJobsForSource(sourceId)
            var existingJob = incompleteJobs.firstOrNull()

            if (existingJob != null) {
                val existingFiles = fileRepo.getFilesForJob(existingJob.jobId)
                val hasActiveTasks = existingFiles.any { it.status in activeFileStatuses }

                if (existingFiles.isNotEmpty() && !hasActiveTasks) {
                    // Stale job where all files were already terminal (INDEXED, SKIPPED_DUPLICATE, METADATA_INDEXED, FAILED)
                    // but the job state was never marked COMPLETED
                    val uploadedCount = existingFiles.count { it.status == FileStatus.INDEXED || it.status == FileStatus.METADATA_INDEXED }
                    val skippedCount = existingFiles.count { it.status == FileStatus.SKIPPED_DUPLICATE }
                    val failedCount = existingFiles.count { it.status == FileStatus.FAILED }
                    jobRepo.updateJobCounters(existingJob.jobId, existingFiles.size, uploadedCount, skippedCount, failedCount)
                    val targetState = if (failedCount > 0 && (uploadedCount + skippedCount) == 0) BackupJobState.FAILED else BackupJobState.COMPLETED
                    transitionJobToTerminalState(existingJob.jobId, targetState, jobRepo)
                    jobRepo.getJob(existingJob.jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
                    Log.i(TAG, "Closed stale incomplete job ${existingJob.jobId} with state $targetState.")
                    existingJob = null
                }
            }

            // Phase 1: If there is an existing job with genuine in-flight/active tasks, recover and complete it first
            if (existingJob != null) {
                currentJobId = existingJob.jobId
                Log.i(TAG, "Resuming genuine in-flight recovery for job ${existingJob.jobId}.")
                executeJobPipeline(
                    jobId = existingJob.jobId,
                    shouldScan = false,
                    sourceId = sourceId,
                    vaultId = vaultId,
                    storageSource = storageSource,
                    fileRepo = fileRepo,
                    jobRepo = jobRepo,
                    reservationRepo = reservationRepo,
                    firestoreRepo = firestoreRepo,
                    uploadRepo = uploadRepo,
                    deduplicationEngine = deduplicationEngine,
                    nameResolver = nameResolver,
                    recoveryEngine = recoveryEngine,
                    scanner = scanner,
                    startTime = startTime,
                    executionBudgetMs = executionBudgetMs
                )
            }

            if (isStopped) return Result.failure()

            // Phase 2: Fresh USB Backup Run
            // After genuine in-flight recovery reaches a terminal state (or if there was no active incomplete job),
            // create a NEW BackupJob and perform fresh discovery of the CURRENT contents of the physical pendrive.
            val remainingIncomplete = jobRepo.getIncompleteJobsForSource(sourceId)
            if (remainingIncomplete.isEmpty() && storageSource.isAvailable() && !isStopped) {
                val newJobId = UUID.randomUUID().toString()
                val newJob = BackupJob(
                    jobId = newJobId,
                    sourceId = sourceId,
                    state = BackupJobState.SCANNING,
                    startedAt = System.currentTimeMillis()
                )
                jobRepo.createJob(newJob)
                firestoreRepo.updateBackupJobState(vaultId, newJob)
                currentJobId = newJobId
                Log.i(TAG, "Starting fresh backup job $newJobId for sourceId=$sourceId.")

                executeJobPipeline(
                    jobId = newJobId,
                    shouldScan = true,
                    sourceId = sourceId,
                    vaultId = vaultId,
                    storageSource = storageSource,
                    fileRepo = fileRepo,
                    jobRepo = jobRepo,
                    reservationRepo = reservationRepo,
                    firestoreRepo = firestoreRepo,
                    uploadRepo = uploadRepo,
                    deduplicationEngine = deduplicationEngine,
                    nameResolver = nameResolver,
                    recoveryEngine = recoveryEngine,
                    scanner = scanner,
                    startTime = startTime,
                    executionBudgetMs = executionBudgetMs
                )
            }

            val incompleteRemaining = jobRepo.getIncompleteJobsForSource(sourceId)
            if (incompleteRemaining.isNotEmpty()) {
                if (!storageSource.isAvailable() || isStopped) {
                    Log.i(TAG, "Storage source unavailable or worker stopped with incomplete jobs. Returning Result.failure().")
                    return Result.failure()
                }
                if (!isForeground) {
                    postPauseNotification()
                }
                Log.i(TAG, "Incomplete backup jobs remain for source $sourceId after budget reached. Returning Result.retry() to safely resume.")
                return Result.retry()
            }

            return Result.success()

        } catch (e: CancellationException) {
            val stopReasonMsg = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                "stopReason=$stopReason"
            } else {
                "worker stopped"
            }
            Log.i(TAG, "BackupWorker coroutine cancelled ($stopReasonMsg).")
            if (currentJobId.isNotBlank()) {
                try {
                    val currentJob = jobRepo.getJob(currentJobId)
                    if (currentJob != null && currentJob.state !in listOf(BackupJobState.COMPLETED, BackupJobState.FAILED, BackupJobState.CANCELLED)) {
                        transitionJobToTerminalState(currentJobId, BackupJobState.CANCELLED, jobRepo)
                        jobRepo.getJob(currentJobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
                        Log.i(TAG, "Cleanly marked active job $currentJobId as CANCELLED on cancellation/timeout.")
                    }
                } catch (cleanupEx: Throwable) {
                    Log.w(TAG, "Failed to mark job as CANCELLED on cancellation: ${cleanupEx.message}")
                }
            }
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Unhandled exception in BackupWorker: ${e.message}", e)
            val isStillAttached = try {
                val storage = testStorageSourceProvider?.invoke(sourceId)
                    ?: StorageSourceFactory(applicationContext).createStorageSource(sourceId)
                storage.isAvailable()
            } catch (_: Throwable) {
                false
            }
            if (!isStillAttached || isStopped) {
                val isPhysicallyConnected = com.usbcloudbackup.storage.SourceIdResolver.isPhysicalUsbAttached(applicationContext, sourceId)
                if (isPhysicallyConnected && !isStopped) {
                    Log.i(TAG, "Storage volume error occurred but device is still physically attached. Returning Result.retry().")
                    return Result.retry()
                }
                Log.i(TAG, "Storage source is no longer available or worker stopped. Aborting cleanly without retry.")
                return Result.failure()
            }
            return Result.retry()
        } finally {
            try {
                applicationContext.unregisterReceiver(detachReceiver)
            } catch (_: Throwable) {}
        }
    }

    private suspend fun executeJobPipeline(
        jobId: String,
        shouldScan: Boolean,
        sourceId: String,
        vaultId: String,
        storageSource: UsbStorageSource,
        fileRepo: FileRepository,
        jobRepo: BackupJobRepository,
        reservationRepo: ReservationRepository,
        firestoreRepo: FirestoreRepository,
        uploadRepo: UploadRepository,
        deduplicationEngine: DeduplicationEngine,
        nameResolver: VersionedNameResolver,
        recoveryEngine: CloudRecoveryEngine,
        scanner: FileScanner,
        startTime: Long,
        executionBudgetMs: Long
    ) {
        val isBudgetExpired: () -> Boolean = {
            System.currentTimeMillis() - startTime >= executionBudgetMs
        }

        // Step 3c: Reconnection Recovery for SOURCE_UNAVAILABLE files if storageSource is available
        if (!shouldScan && storageSource.isAvailable()) {
            val existingFiles = fileRepo.getFilesForJob(jobId)
            for (file in existingFiles) {
                if (file.status == FileStatus.SOURCE_UNAVAILABLE) {
                    if (file.sha256.isNullOrBlank()) {
                        fileRepo.updateFileStatus(file.id, FileStatus.DISCOVERED)
                    } else {
                        fileRepo.updateFileStatus(file.id, FileStatus.HASHED)
                    }
                }
            }
        }

        var activeStorageSource = storageSource

        // Step 4: Scan USB Source & Smart Backup Policy Classification (if fresh run or un-scanned)
        if (shouldScan) {
            val targetScanState = BackupJobState.SCANNING
            val currentJob = jobRepo.getJob(jobId)
            if (currentJob?.state != targetScanState && currentJob?.state?.canTransitionTo(targetScanState) == true) {
                jobRepo.updateJobState(jobId, targetScanState)
            }

            var discoveredFiles = scanner.scanSource(jobId, activeStorageSource)
            Log.i(TAG, "Discovery scan complete for jobId=$jobId. Found ${discoveredFiles.size} files.")

            // Mount Settling & Delayed Discovery Wait:
            // If 0 files were discovered, but a physical USB mass storage device is attached,
            // the USB drive may still be in the process of being mounted by the OS volume daemon (vold).
            // Await mount settling before concluding the drive is empty or finishing.
            if (discoveredFiles.isEmpty() && com.usbcloudbackup.storage.SourceIdResolver.isPhysicalUsbAttached(applicationContext, sourceId)) {
                val settlingBudgetMs = testMountWaitTimeoutMs ?: 15_000L
                val settlingPollIntervalMs = testMountPollIntervalMs ?: 1_000L
                val settlingStart = System.currentTimeMillis()

                Log.i(TAG, "Discovered 0 files on physically attached USB drive $sourceId. Volume may still be mounting. Awaiting mount settling and contents (budget=${settlingBudgetMs}ms)...")

                while (System.currentTimeMillis() - settlingStart < settlingBudgetMs && !isStopped && !isBudgetExpired()) {
                    kotlinx.coroutines.delay(settlingPollIntervalMs)
                    if (isStopped || isBudgetExpired()) break

                    if (!com.usbcloudbackup.storage.SourceIdResolver.isPhysicalUsbAttached(applicationContext, sourceId)) {
                        Log.w(TAG, "USB drive $sourceId detached during mount settling wait.")
                        break
                    }

                    val recheckedStorage = testStorageSourceProvider?.invoke(sourceId)
                        ?: StorageSourceFactory(applicationContext).createStorageSource(sourceId)

                    if (recheckedStorage.isAvailable()) {
                        try {
                            val probeFiles = recheckedStorage.discoverFiles()
                            if (probeFiles.isNotEmpty()) {
                                Log.i(TAG, "Storage source $sourceId settled after delay. Discovered ${probeFiles.size} files.")
                                activeStorageSource = recheckedStorage
                                discoveredFiles = scanner.scanSource(jobId, activeStorageSource)
                                break
                            }
                        } catch (e: Exception) {
                            Log.d(TAG, "Transient error probing files during settling: ${e.message}")
                        }
                    }
                }
            }

            jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
        } else {
            val fileCount = fileRepo.getFilesForJob(jobId).size
            Log.i(TAG, "Resuming existing backup job $jobId with $fileCount files.")
        }

        // Step 4b: Index Category B (Metadata-Only) files directly in Cloud Firestore
        val currentJobFiles = fileRepo.getFilesForJob(jobId)
        for (file in currentJobFiles) {
            if (isStopped || isBudgetExpired()) break
            if (file.backupMode == BackupMode.METADATA_ONLY.name) {
                if (file.status == FileStatus.DISCOVERED) {
                    try {
                        firestoreRepo.indexMetadataOnlyFile(vaultId, file, jobId)
                        fileRepo.updateFileStatus(file.id, FileStatus.METADATA_INDEXED)
                        Log.i(TAG, "Indexed metadata-only file: ${file.originalName}")
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed indexing metadata-only file: ${file.originalName}", e)
                        fileRepo.updateFileStatus(file.id, FileStatus.FAILED, e.message)
                    }
                }
            }
        }

        if (isStopped || isBudgetExpired()) return

        // Step 5: Streaming SHA-256 Hash Stage (Category A Automatic Backup)
        val descriptorsMap = activeStorageSource.discoverFiles().associateBy { "${it.relativePath}${it.originalName}" }

        val unhashedFiles = fileRepo.getFilesForJob(jobId).filter { file ->
            (file.status == FileStatus.DISCOVERED || file.status == FileStatus.HASHING) &&
                    file.backupMode == BackupMode.AUTOMATIC.name
        }

        if (unhashedFiles.isNotEmpty()) {
            val targetHashState = BackupJobState.HASHING
            val currentJob = jobRepo.getJob(jobId)
            if (currentJob?.state != targetHashState && currentJob?.state?.canTransitionTo(targetHashState) == true) {
                jobRepo.updateJobState(jobId, targetHashState)
                jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
            }

            for (file in unhashedFiles) {
                if (isStopped || isBudgetExpired()) {
                    Log.i(TAG, "Hashing paused due to budget expiration or stop request.")
                    break
                }

                val key = "${file.relativePath}${file.originalName}"
                val descriptor = descriptorsMap[key]
                if (descriptor == null) {
                    fileRepo.updateFileStatus(file.id, FileStatus.SOURCE_UNAVAILABLE, "Descriptor not found on storage source")
                    continue
                }

                fileRepo.updateFileStatus(file.id, FileStatus.HASHING)
                try {
                    descriptor.openInputStream().use { inputStream ->
                        val hash = Sha256Calculator.calculateHash(inputStream)
                        fileRepo.updateFileHash(file.id, hash, FileStatus.HASHED)
                    }
                } catch (e: IOException) {
                    Log.w(TAG, "I/O failure hashing file ${file.originalName}. Marking SOURCE_UNAVAILABLE.", e)
                    fileRepo.updateFileStatus(file.id, FileStatus.SOURCE_UNAVAILABLE, e.message)
                } catch (e: Exception) {
                    Log.w(TAG, "Non-fatal error hashing file ${file.originalName}. Marking FAILED.", e)
                    fileRepo.updateFileStatus(file.id, FileStatus.FAILED, e.message)
                }
            }
        }

        if (isStopped || isBudgetExpired()) return

        // Step 6: Deduplication Stage (Candidate files MUST be hashed before deduplication check)
        val filesToDeduplicate = fileRepo.getFilesForJob(jobId).filter { file ->
            file.status == FileStatus.HASHED && !file.sha256.isNullOrBlank()
        }

        if (filesToDeduplicate.isNotEmpty()) {
            val targetDedupState = BackupJobState.DEDUPLICATING
            val currentJob = jobRepo.getJob(jobId)
            if (currentJob?.state != targetDedupState && currentJob?.state?.canTransitionTo(targetDedupState) == true) {
                jobRepo.updateJobState(jobId, targetDedupState)
                jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
            }

            var lastDedupSync = System.currentTimeMillis()
            var dedupProcessed = 0

            for (file in filesToDeduplicate) {
                if (isStopped || isBudgetExpired()) {
                    Log.i(TAG, "Deduplication paused due to budget expiration or stop request.")
                    break
                }

                // 6a. Local Room Deduplication Check
                val localDedup = deduplicationEngine.checkLocalDeduplication(file)
                if (localDedup is DeduplicationResult.SkippedDuplicate) {
                    dedupProcessed++
                    if (dedupProcessed >= 25 || System.currentTimeMillis() - lastDedupSync >= 30_000L) {
                        jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
                        lastDedupSync = System.currentTimeMillis()
                        dedupProcessed = 0
                    }
                    continue
                }

                // 6b. Cloud Firestore Content Hash Deduplication Check
                val isCloudDuplicate = recoveryEngine.checkCloudDeduplication(vaultId, file)
                if (isCloudDuplicate) {
                    dedupProcessed++
                    if (dedupProcessed >= 25 || System.currentTimeMillis() - lastDedupSync >= 30_000L) {
                        jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
                        lastDedupSync = System.currentTimeMillis()
                        dedupProcessed = 0
                    }
                    continue
                }
            }
            jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
        }

        if (isStopped || isBudgetExpired()) return

        // Step 7: Uploading & Finalization Stage
        val uploadableFiles = fileRepo.getFilesForJob(jobId).filter { file ->
            (file.status == FileStatus.HASHED && !file.sha256.isNullOrBlank()) ||
                    file.status == FileStatus.NAME_RESERVED ||
                    file.status == FileStatus.UPLOADING ||
                    file.status == FileStatus.UPLOADED_NOT_INDEXED
        }

        if (uploadableFiles.isNotEmpty()) {
            val targetUploadState = BackupJobState.UPLOADING
            val currentJob = jobRepo.getJob(jobId)
            if (currentJob?.state != targetUploadState && currentJob?.state?.canTransitionTo(targetUploadState) == true) {
                jobRepo.updateJobState(jobId, targetUploadState)
                jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
            }

            var lastUploadSync = System.currentTimeMillis()
            var uploadProcessed = 0

            for (file in uploadableFiles) {
                if (isStopped || isBudgetExpired()) {
                    Log.i(TAG, "Uploading paused due to budget expiration or stop request.")
                    break
                }

                if (!activeStorageSource.isAvailable()) {
                    Log.w(TAG, "Storage source detached during upload loop. Stopping.")
                    if (file.status != FileStatus.UPLOADED_NOT_INDEXED) {
                        fileRepo.updateFileStatus(file.id, FileStatus.SOURCE_UNAVAILABLE, "USB detached")
                    }
                    break
                }

                // JIT Deduplication Check:
                // If a preceding file in this batch or concurrent worker already completed upload/index:
                if (file.status != FileStatus.UPLOADED_NOT_INDEXED && !file.sha256.isNullOrBlank()) {
                    val validDup = fileRepo.findValidDuplicateBySha256(file.sha256!!)
                    val isCloudDup = if (validDup == null) recoveryEngine.checkCloudDeduplication(vaultId, file) else false
                    if ((validDup != null && validDup.id != file.id) || isCloudDup) {
                        Log.i(TAG, "JIT deduplication matched for fileId=${file.id}, originalName=${file.originalName}. Cleaning up reservation/task and skipping upload.")
                        val existingTask = uploadRepo.getTaskForFile(file.id)
                        if (existingTask != null) {
                            uploadRepo.deleteTaskForFile(file.id)
                            if (existingTask.reservationId.isNotBlank()) {
                                try {
                                    reservationRepo.deleteReservation(existingTask.reservationId)
                                } catch (_: Exception) {}
                            }
                        }
                        fileRepo.updateFileStatus(file.id, FileStatus.SKIPPED_DUPLICATE)
                        jobRepo.incrementSkipped(jobId)
                        jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
                        continue
                    }
                }

                val ownerTaskId = id.toString()
                if (file.status != FileStatus.UPLOADED_NOT_INDEXED) {
                    val cloudRes = firestoreRepo.reserveCloudFilename(
                        vaultId = vaultId,
                        sourceId = file.sourceId,
                        relativePath = file.relativePath,
                        originalName = file.originalName,
                        sha256 = file.sha256!!,
                        jobId = jobId,
                        ownerTaskId = ownerTaskId
                    )

                    // Sync with local Room NameReservation & UploadTask
                    nameResolver.reserveFilename(vaultId, file, ownerTaskId, preferredVersion = cloudRes.version)
                }

                val task = uploadRepo.getTaskForFile(file.id) ?: run {
                    val candidateName = file.cloudFilename ?: file.originalName
                    val b2Key = file.b2ObjectKey ?: com.usbcloudbackup.util.ReservationUtils.buildB2ObjectKey(vaultId, file.sourceId, file.relativePath, candidateName)
                    val newTask = com.usbcloudbackup.backup.model.UploadTask(
                        taskId = UUID.randomUUID().toString(),
                        fileId = file.id,
                        b2ObjectKey = b2Key,
                        state = if (file.status == FileStatus.UPLOADED_NOT_INDEXED) com.usbcloudbackup.backup.model.UploadTaskState.UPLOADED_NOT_INDEXED else com.usbcloudbackup.backup.model.UploadTaskState.RESERVED,
                        reservationId = "",
                        sha256 = file.sha256 ?: "",
                        bytesTransferred = file.size,
                        totalBytes = file.size,
                        updatedAt = System.currentTimeMillis()
                    )
                    uploadRepo.createTask(newTask)
                    newTask
                }

                val key = "${file.relativePath}${file.originalName}"
                val descriptor = descriptorsMap[key]
                if (descriptor == null && file.status != FileStatus.UPLOADED_NOT_INDEXED) {
                    fileRepo.updateFileStatus(file.id, FileStatus.SOURCE_UNAVAILABLE, "Descriptor missing for upload")
                    continue
                }

                try {
                    recoveryEngine.processOrRecoverUpload(
                        vaultId = vaultId,
                        file = fileRepo.getFile(file.id)!!,
                        task = task,
                        inputStreamProvider = { descriptor?.openInputStream() ?: java.io.ByteArrayInputStream(ByteArray(0)) }
                    )
                } catch (e: IOException) {
                    if (!activeStorageSource.isAvailable() || isStopped) {
                        Log.w(TAG, "Storage source detached during upload of ${file.originalName}")
                        if (fileRepo.getFile(file.id)?.status != FileStatus.UPLOADED_NOT_INDEXED) {
                            fileRepo.updateFileStatus(file.id, FileStatus.SOURCE_UNAVAILABLE, e.message)
                        }
                        break
                    }
                    Log.e(TAG, "Upload failure for file ${file.originalName}: ${e.message}. Marking FAILED to unblock backup queue.", e)
                    fileRepo.updateFileStatus(file.id, FileStatus.FAILED, e.message)
                    jobRepo.incrementError(jobId)
                    continue
                }

                uploadProcessed++
                if (uploadProcessed >= 25 || System.currentTimeMillis() - lastUploadSync >= 30_000L) {
                    jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
                    lastUploadSync = System.currentTimeMillis()
                    uploadProcessed = 0
                }
            }
            jobRepo.getJob(jobId)?.let { firestoreRepo.updateBackupJobState(vaultId, it) }
        }

        // Step 8: Complete BackupJob
        val remainingFiles = fileRepo.getFilesForJob(jobId)
        val terminalStatuses = setOf(
            FileStatus.INDEXED,
            FileStatus.SKIPPED_DUPLICATE,
            FileStatus.METADATA_INDEXED,
            FileStatus.FAILED
        )
        val unfinishedFiles = remainingFiles.filter { it.status !in terminalStatuses }

        val uploadedCount = remainingFiles.count { it.status == FileStatus.INDEXED || it.status == FileStatus.METADATA_INDEXED }
        val skippedCount = remainingFiles.count { it.status == FileStatus.SKIPPED_DUPLICATE }
        val failedCount = remainingFiles.count { it.status == FileStatus.FAILED }

        jobRepo.updateJobCounters(
            jobId = jobId,
            total = remainingFiles.size,
            uploaded = uploadedCount,
            skipped = skippedCount,
            error = failedCount
        )

        if (unfinishedFiles.isEmpty()) {
            val targetJobState = if (failedCount > 0 && (uploadedCount + skippedCount) == 0 && remainingFiles.isNotEmpty()) {
                BackupJobState.FAILED
            } else {
                BackupJobState.COMPLETED
            }

            transitionJobToTerminalState(jobId, targetJobState, jobRepo)
            val finalJob = jobRepo.getJob(jobId)
            if (finalJob != null) {
                firestoreRepo.updateBackupJobState(vaultId, finalJob)
            }
            Log.i(TAG, "BackupWorker finished job $jobId successfully with state $targetJobState.")
        } else {
            Log.w(TAG, "BackupWorker finished iteration for job $jobId with ${unfinishedFiles.size} unfinished files remaining (budgetExpired=${isBudgetExpired()}, isStopped=$isStopped). Job state left active for retry.")
        }
    }

    private suspend fun transitionJobToTerminalState(
        jobId: String,
        targetState: BackupJobState,
        jobRepo: BackupJobRepository
    ) {
        val currentJob = jobRepo.getJob(jobId) ?: return
        if (currentJob.state == targetState) return

        if (currentJob.state.canTransitionTo(targetState)) {
            jobRepo.updateJobState(jobId, targetState, System.currentTimeMillis())
            return
        }

        // Bridge intermediate states to satisfy strict state machine transitions
        if (currentJob.state == BackupJobState.SCANNING) {
            if (targetState == BackupJobState.COMPLETED) {
                jobRepo.updateJobState(jobId, BackupJobState.HASHING)
                jobRepo.updateJobState(jobId, BackupJobState.DEDUPLICATING)
                jobRepo.updateJobState(jobId, BackupJobState.COMPLETED, System.currentTimeMillis())
                return
            }
        } else if (currentJob.state == BackupJobState.HASHING) {
            if (targetState == BackupJobState.COMPLETED) {
                jobRepo.updateJobState(jobId, BackupJobState.DEDUPLICATING)
                jobRepo.updateJobState(jobId, BackupJobState.COMPLETED, System.currentTimeMillis())
                return
            }
        }

        if (jobRepo.getJob(jobId)?.state?.canTransitionTo(targetState) == true) {
            jobRepo.updateJobState(jobId, targetState, System.currentTimeMillis())
        }
    }

    fun createForegroundInfo(): ForegroundInfo {
        val notificationManager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Bright Cloud",
                NotificationManager.IMPORTANCE_LOW
            )
            notificationManager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setContentTitle("Bright Cloud")
            .setContentText("Backing up USB storage...")
            .setSmallIcon(android.R.drawable.ic_menu_upload)
            .setOngoing(true)
            .build()

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        return createForegroundInfo()
    }

    @VisibleForTesting
    internal suspend fun promoteToForegroundIfPossible(): Boolean {
        try {
            // Check POST_NOTIFICATIONS permission on Android 13+ (API 33+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val hasPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                    applicationContext,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!hasPermission) {
                    Log.i(TAG, "Notification permission not granted. Running BackupWorker in standard background mode.")
                    return false
                }
            }

            val foregroundInfo = createForegroundInfo()
            if (testSetForegroundOverride != null) {
                testSetForegroundOverride!!.invoke(foregroundInfo)
            } else {
                setForeground(foregroundInfo)
            }
            Log.i(TAG, "Promoted BackupWorker to foreground service (dataSync).")
            return true
        } catch (e: SecurityException) {
            // Missing foreground service permission or Android OS security policy rejection
            Log.i(TAG, "Foreground promotion skipped due to SecurityException (${e.message}). Proceeding safely in degraded background WorkManager execution.")
            return false
        } catch (e: IllegalStateException) {
            // Catches ForegroundServiceStartNotAllowedException on Android 12+ (API 31+) as it extends IllegalStateException,
            // as well as WorkManager state errors (e.g. worker stopped/cancelled before setForeground completed)
            Log.i(TAG, "Foreground promotion skipped (${e.javaClass.simpleName}: ${e.message}). Proceeding safely in degraded background WorkManager execution.")
            return false
        }
    }

    private fun postPauseNotification() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val hasPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                    applicationContext,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!hasPermission) return
            }

            val notificationManager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Bright Cloud",
                    NotificationManager.IMPORTANCE_LOW
                )
                notificationManager.createNotificationChannel(channel)
            }

            val resumeIntent = Intent(applicationContext, com.usbcloudbackup.setup.MainActivity::class.java).apply {
                action = com.usbcloudbackup.setup.MainActivity.ACTION_RESUME_BACKUP
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                applicationContext,
                0,
                resumeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
                .setContentTitle("Bright Cloud")
                .setContentText("USB backup paused in background. Tap to resume.")
                .setSmallIcon(android.R.drawable.ic_menu_upload)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .build()

            notificationManager.notify(NOTIFICATION_ID_PAUSED, notification)
            Log.i(TAG, "Posted background pause notification.")
        } catch (e: Throwable) {
            Log.w(TAG, "Could not post background pause notification: ${e.message}")
        }
    }

    private suspend fun drainPendingDeletions(
        pendingDeletionStore: IPendingDeletionStore,
        storageRepo: CloudStorageRepository
    ) {
        try {
            val pending = pendingDeletionStore.getPendingDeletions()
            if (pending.isNotEmpty()) {
                Log.i(TAG, "Draining ${pending.size} pending B2 deletions during BackupWorker startup.")
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
