package com.usbcloudbackup.worker

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.policy.BackupMode
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.SourceRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.storage.FakeCloudStorageRepository
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.hashing.Sha256Calculator
import com.usbcloudbackup.storage.FakeStorageSource
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BackupWorkerTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var jobRepo: BackupJobRepository
    private lateinit var fileRepo: FileRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var fakeAuth: AuthRepository

    private val testUid = "daemon_device_001"
    private val testSourceId = "usb-worker-source-001"

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        AppDatabase.setTestInstance(db)

        val sourceRepo = SourceRepository(db.sourceDao())
        runBlocking {
            sourceRepo.saveSource(
                UsbSource(
                    sourceId = testSourceId,
                    usbVendorId = 0,
                    usbProductId = 0,
                    serialNumber = null,
                    volumeUuid = null,
                    displayName = "Test USB",
                    firstSeen = System.currentTimeMillis(),
                    lastSeen = System.currentTimeMillis()
                )
            )
        }

        jobRepo = BackupJobRepository(db.backupJobDao())
        fileRepo = FileRepository(db.fileDao())

        fakeFirestore = FakeFirestoreRepository()
        fakeStorage = FakeCloudStorageRepository()

        fakeAuth = object : AuthRepository {
            override fun getCurrentUid(): String = testUid
            override fun isAuthenticated(): Boolean = true
            override suspend fun ensureAuthenticated(): String = testUid
            override fun getAuthMethod(): String = "anonymous"
        }

        BackupWorker.testAuthRepositoryOverride = fakeAuth
        BackupWorker.testFirestoreRepositoryOverride = fakeFirestore
        BackupWorker.testCloudStorageRepositoryOverride = fakeStorage
    }

    @After
    fun tearDown() {
        BackupWorker.testStorageSourceProvider = null
        BackupWorker.testAuthRepositoryOverride = null
        BackupWorker.testFirestoreRepositoryOverride = null
        BackupWorker.testCloudStorageRepositoryOverride = null
        BackupWorker.testExecutionBudgetMs = null
        BackupWorker.testPendingDeletionStoreOverride = null
        BackupWorker.testSetForegroundOverride = null
        AppDatabase.setTestInstance(null)
        db.close()
        fakeFirestore.clear()
        fakeStorage.clear()
    }

    @Test
    fun testBackupWorkerNormalExecutionSuccess() {
        val fakeSource = FakeStorageSource(testSourceId, "Worker Test USB")
        val contentBytes = "Hello BackupWorker Test!".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("Docs/", "File1.txt", contentBytes)
        fakeSource.addFile("Docs/", "File2.txt", "Content 2".toByteArray(Charsets.UTF_8))

        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            val incompleteJobs = jobRepo.getAllIncompleteJobs()
            assertEquals(0, incompleteJobs.size)

            val jobs = jobRepo.getJobsForSource(testSourceId)
            assertEquals(1, jobs.size)
            assertEquals(BackupJobState.COMPLETED, jobs[0].state)

            val files = fileRepo.getFilesForJob(jobs[0].jobId)
            assertEquals(2, files.size)
            assertTrue(files.all { it.status == FileStatus.INDEXED })

            // Verify Cloud Storage & Firestore
            assertEquals(2, fakeStorage.getStoredObjectCount())
            assertEquals(2, fakeFirestore.files.size)
            assertEquals(2, fakeFirestore.contentHashes.size)
        }
    }

    @Test
    fun testBackupWorkerAuthFailureRetries() {
        // Failing auth
        val failingAuth = object : AuthRepository {
            override fun getCurrentUid(): String? = null
            override fun isAuthenticated(): Boolean = false
            override suspend fun ensureAuthenticated(): String = throw RuntimeException("Auth failed")
            override fun getAuthMethod(): String = "unauthenticated"
        }
        BackupWorker.testAuthRepositoryOverride = failingAuth

        val fakeSource = FakeStorageSource(testSourceId, "Worker Test USB")
        fakeSource.addFile("Docs/", "File1.txt", "content".toByteArray(Charsets.UTF_8))
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.retry(), result)
            assertEquals(0, fakeStorage.getStoredObjectCount())
        }
    }

    @Test
    fun testBackupWorkerSourceUnavailableAbortsCleanlyWithoutRetry() {
        val fakeSource = FakeStorageSource(testSourceId, "Unavailable USB")
        fakeSource.setAvailable(false)

        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.failure(), result)
        }
    }

    @Test
    fun testBackupWorkerWhenPhysicalUsbAttachedButVolumeNotMountedRetries() {
        val usbManager = mockk<UsbManager>(relaxed = true)
        val usbDevice = mockk<UsbDevice>(relaxed = true)
        every { usbDevice.vendorId } returns 1008
        every { usbDevice.productId } returns 8195
        every { usbDevice.deviceClass } returns android.hardware.usb.UsbConstants.USB_CLASS_MASS_STORAGE
        every { usbManager.deviceList } returns hashMapOf("dev1" to usbDevice)

        // Context mock or shadow for UsbManager
        val shadowContext = org.robolectric.Shadows.shadowOf(context as android.app.Application)
        shadowContext.setSystemService(Context.USB_SERVICE, usbManager)

        val fakeSource = FakeStorageSource("1008-8195-0CF3-4237", "Unavailable USB")
        fakeSource.setAvailable(false)
        BackupWorker.testStorageSourceProvider = { fakeSource }
        BackupWorker.testMountWaitTimeoutMs = 50L
        BackupWorker.testMountPollIntervalMs = 10L

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to "1008-8195-0CF3-4237"))
            .build()

        runBlocking {
            val result = worker.doWork()
            // Physical USB attached but mount not ready -> MUST return retry()!
            assertEquals(ListenableWorker.Result.retry(), result)
        }
    }

    @Test
    fun testBackupWorkerWhenVolumeBecomesAvailableDuringWorkerWaitSucceeds() {
        val usbManager = mockk<UsbManager>(relaxed = true)
        val usbDevice = mockk<UsbDevice>(relaxed = true)
        every { usbDevice.vendorId } returns 1008
        every { usbDevice.productId } returns 8195
        every { usbDevice.deviceClass } returns android.hardware.usb.UsbConstants.USB_CLASS_MASS_STORAGE
        every { usbManager.deviceList } returns hashMapOf("dev1" to usbDevice)
        val shadowContext = org.robolectric.Shadows.shadowOf(context as android.app.Application)
        shadowContext.setSystemService(Context.USB_SERVICE, usbManager)

        var isAvailable = false
        val fakeSource = object : FakeStorageSource("1008-8195-0CF3-4237", "Late Ready USB") {
            override suspend fun isAvailable(): Boolean = isAvailable
        }
        fakeSource.addFile("Docs/", "File1.txt", "hello".toByteArray(Charsets.UTF_8))
        BackupWorker.testStorageSourceProvider = { fakeSource }
        BackupWorker.testMountWaitTimeoutMs = 500L
        BackupWorker.testMountPollIntervalMs = 20L

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to "1008-8195-0CF3-4237"))
            .build()

        runBlocking {
            launch {
                delay(60L)
                isAvailable = true
            }
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)
        }
    }

    @Test
    fun testBackupWorkerIdempotentReExecution() {
        val fakeSource = FakeStorageSource(testSourceId, "Worker Idempotent USB")
        val contentBytes = "Idempotent content".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("Docs/", "File1.txt", contentBytes)

        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            // First execution
            val worker1 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result1 = worker1.doWork()
            assertEquals(ListenableWorker.Result.success(), result1)

            val uploadsFirstRun = fakeStorage.uploadCount
            assertEquals(1, uploadsFirstRun)

            // Second execution on same source
            val worker2 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result2 = worker2.doWork()
            assertEquals(ListenableWorker.Result.success(), result2)

            // Verify no additional byte uploads were performed
            assertEquals(uploadsFirstRun, fakeStorage.uploadCount)
        }
    }

    @Test
    fun testCandidateFileHashedBeforeDedupAndNewFileUploaded() {
        val fakeSource = FakeStorageSource(testSourceId, "Worker Dedup Order USB")
        val contentBytes = "Unique candidate content 12345".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("Docs/", "Candidate.pdf", contentBytes)

        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            val jobs = jobRepo.getJobsForSource(testSourceId)
            assertEquals(1, jobs.size)
            val files = fileRepo.getFilesForJob(jobs[0].jobId)
            assertEquals(1, files.size)
            val file = files[0]
            // Verify file was hashed and indexed
            assertEquals(FileStatus.INDEXED, file.status)
            assertNotNull("Candidate file must have sha256 computed before upload", file.sha256)
            assertEquals(1, fakeStorage.getStoredObjectCount())
            assertEquals(1, fakeFirestore.files.size)
            assertEquals(1, fakeFirestore.contentHashes.size)
        }
    }

    @Test
    fun testMetadataOnlyFileIndexingFailureDoesNotCausePrematureDedupCrash() {
        val fakeSource = FakeStorageSource(testSourceId, "Worker Metadata Failure USB")
        val bigVideoBytes = ByteArray(1024)
        fakeSource.addFile("Videos/", "vacation.mp4", bigVideoBytes)

        fakeFirestore.shouldFailMetadataIndexing = true
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val jobId = "job-metadata-failure"
        runBlocking {
            jobRepo.createJob(
                BackupJob(
                    jobId = jobId,
                    sourceId = testSourceId,
                    state = BackupJobState.SCANNING,
                    startedAt = System.currentTimeMillis()
                )
            )
            fileRepo.addDiscoveredFile(
                BackupFile(
                    jobId = jobId,
                    sourceId = testSourceId,
                    relativePath = "Videos/",
                    originalName = "vacation.mp4",
                    size = 1024L,
                    lastModified = System.currentTimeMillis(),
                    status = FileStatus.DISCOVERED,
                    backupMode = BackupMode.METADATA_ONLY.name
                )
            )
        }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            // Must NOT throw "IllegalStateException: File must be hashed before deduplication check"
            val result = worker.doWork()
            val files = fileRepo.getFilesForJob(jobId)
            assertEquals(1, files.size)
            val file = files[0]
            assertEquals(FileStatus.FAILED, file.status)
        }
    }

    @Test
    fun testModifiedFileTriggersVersioningAndUploadsNewVersion() {
        val fakeSource = FakeStorageSource(testSourceId, "Versioning Pendrive")
        val contentA = "Original Human Eye Chapter 1".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("", "HUMAN_EYE.pdf", contentA)

        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            // First execution: Job 1 uploads original HUMAN_EYE.pdf (version 0)
            val worker1 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result1 = worker1.doWork()
            assertEquals(ListenableWorker.Result.success(), result1)

            val jobs1 = jobRepo.getJobsForSource(testSourceId)
            assertEquals(1, jobs1.size)
            assertEquals(BackupJobState.COMPLETED, jobs1[0].state)

            val filesJob1 = fileRepo.getFilesForJob(jobs1[0].jobId)
            assertEquals(1, filesJob1.size)
            assertEquals("HUMAN_EYE.pdf", filesJob1[0].originalName)
            assertEquals(FileStatus.INDEXED, filesJob1[0].status)
            val hashA = filesJob1[0].sha256
            assertNotNull(hashA)

            // Verify Firestore & Storage for version 0
            assertEquals(1, fakeStorage.uploadCount)
            val b2Key0 = "backups/default/$testSourceId/HUMAN_EYE.pdf"
            assertNotNull(fakeStorage.getStoredBytes(b2Key0))

            // Now modify HUMAN_EYE.pdf on the physical pendrive (content B, SHA_B != SHA_A)
            // Filename on the USB pendrive remains EXACTLY "HUMAN_EYE.pdf"
            val contentB = "Modified Human Eye Chapter 1 with 1 byte difference".toByteArray(Charsets.UTF_8)
            fakeSource.addFile("", "HUMAN_EYE.pdf", contentB)

            // Second execution: Job 2 must perform fresh discovery and upload HUMAN_EYE(1).pdf
            val worker2 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result2 = worker2.doWork()
            assertEquals(ListenableWorker.Result.success(), result2)

            val jobs2 = jobRepo.getJobsForSource(testSourceId)
            assertEquals(2, jobs2.size)
            assertEquals(BackupJobState.COMPLETED, jobs2[0].state)
            assertEquals(BackupJobState.COMPLETED, jobs2[1].state)

            val job2 = jobs2.first { it.jobId != jobs1[0].jobId }
            val filesJob2 = fileRepo.getFilesForJob(job2.jobId)
            assertEquals(1, filesJob2.size)
            val versionedFile = filesJob2[0]
            assertEquals("HUMAN_EYE.pdf", versionedFile.originalName)
            assertEquals("HUMAN_EYE(1).pdf", versionedFile.cloudFilename)
            assertEquals(FileStatus.INDEXED, versionedFile.status)
            val hashB = versionedFile.sha256
            assertNotNull(hashB)
            assertTrue("Hash of modified file must differ from original", hashA != hashB)

            // Verify B2 storage now has BOTH version 0 and version 1 preserved
            assertEquals(2, fakeStorage.uploadCount)
            val b2Key1 = "backups/default/$testSourceId/HUMAN_EYE(1).pdf"
            assertNotNull("Original version 0 must remain in B2", fakeStorage.getStoredBytes(b2Key0))
            assertNotNull("Version 1 must be stored in B2", fakeStorage.getStoredBytes(b2Key1))

            // Verify Firestore has both file documents and both content hashes
            assertEquals(2, fakeFirestore.files.size)
            assertEquals(2, fakeFirestore.contentHashes.size)
        }
    }

    @Test
    fun testStaleIncompleteJobWithoutActiveTasksIsClosedAndFreshDiscoveryRuns() {
        val fakeSource = FakeStorageSource(testSourceId, "Stale Job Pendrive")
        val contentBytes = "Some doc content".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("", "doc.txt", contentBytes)

        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            // Seed a stale job in Room that was left in UPLOADING with an already-indexed file
            val staleJobId = "stale-job-123"
            val staleJob = BackupJob(
                jobId = staleJobId,
                sourceId = testSourceId,
                state = BackupJobState.UPLOADING,
                startedAt = System.currentTimeMillis() - 10000
            )
            jobRepo.createJob(staleJob)
            val file1 = com.usbcloudbackup.backup.model.BackupFile(
                jobId = staleJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "doc.txt",
                extension = "txt",
                size = contentBytes.size.toLong(),
                lastModified = 1000L,
                status = FileStatus.INDEXED,
                sha256 = "dummyhash123"
            )
            fileRepo.addDiscoveredFile(file1)

            // Stale job has 1 file which is INDEXED (terminal, no active tasks)
            val incompleteBefore = jobRepo.getIncompleteJobsForSource(testSourceId)
            assertEquals(1, incompleteBefore.size)
            assertEquals(staleJobId, incompleteBefore[0].jobId)

            // Execute worker
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            // Stale job must now be COMPLETED
            val closedStaleJob = jobRepo.getJob(staleJobId)
            assertNotNull(closedStaleJob)
            assertEquals(BackupJobState.COMPLETED, closedStaleJob!!.state)

            // A NEW job must have been created and executed
            val allJobs = jobRepo.getJobsForSource(testSourceId)
            assertEquals(2, allJobs.size)
            val newJob = allJobs.first { it.jobId != staleJobId }
            assertEquals(BackupJobState.COMPLETED, newJob.state)
        }
    }

    @Test
    fun testUnchangedFilesSkippedAsDuplicatesWhileModifiedFileUploaded() {
        val fakeSource = FakeStorageSource(testSourceId, "Multi File Pendrive")
        fakeSource.addFile("Notes/", "doc1.txt", "Content 1".toByteArray(Charsets.UTF_8))
        fakeSource.addFile("Notes/", "doc2.txt", "Content 2".toByteArray(Charsets.UTF_8))
        fakeSource.addFile("", "HUMAN_EYE.pdf", "Content Eye 1".toByteArray(Charsets.UTF_8))

        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            // First run: uploads all 3 files
            val worker1 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result1 = worker1.doWork()
            assertEquals(ListenableWorker.Result.success(), result1)
            assertEquals(3, fakeStorage.uploadCount)

            // Modify only HUMAN_EYE.pdf, leaving doc1.txt and doc2.txt unchanged
            fakeSource.addFile("", "HUMAN_EYE.pdf", "Content Eye 2 (Modified)".toByteArray(Charsets.UTF_8))

            // Second run
            val worker2 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result2 = worker2.doWork()
            assertEquals(ListenableWorker.Result.success(), result2)

            // Only 1 additional byte upload to B2 (HUMAN_EYE(1).pdf)
            assertEquals(4, fakeStorage.uploadCount)

            val jobs = jobRepo.getJobsForSource(testSourceId)
            assertEquals(2, jobs.size)
            val job2 = jobs.maxByOrNull { it.startedAt }!!
            val job2Files = fileRepo.getFilesForJob(job2.jobId)
            assertEquals(3, job2Files.size)

            val skippedFiles = job2Files.filter { it.status == FileStatus.SKIPPED_DUPLICATE }
            assertEquals(2, skippedFiles.size)
            val uploadedFile = job2Files.first { it.status == FileStatus.INDEXED }
            assertEquals("HUMAN_EYE.pdf", uploadedFile.originalName)
            assertEquals("HUMAN_EYE(1).pdf", uploadedFile.cloudFilename)
        }
    }

    @Test
    fun testGenuineInFlightRecoveryReachesTerminalStateThenNextPhaseRunsFreshDiscovery() {
        val fakeSource = FakeStorageSource(testSourceId, "Recovery Pendrive")
        val contentA = "Old in-flight file content".toByteArray(Charsets.UTF_8)
        val contentB = "Newly discovered file on USB".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("Docs/", "old_flight.txt", contentA)
        fakeSource.addFile("Docs/", "new_file.txt", contentB)

        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            val inFlightJobId = "in-flight-job-001"
            val inFlightJob = BackupJob(
                jobId = inFlightJobId,
                sourceId = testSourceId,
                state = BackupJobState.UPLOADING,
                startedAt = System.currentTimeMillis() - 5000
            )
            jobRepo.createJob(inFlightJob)
            val oldFile = com.usbcloudbackup.backup.model.BackupFile(
                jobId = inFlightJobId,
                sourceId = testSourceId,
                relativePath = "Docs/",
                originalName = "old_flight.txt",
                cloudFilename = "old_flight.txt",
                extension = "txt",
                size = contentA.size.toLong(),
                lastModified = 1000L,
                status = FileStatus.UPLOADED_NOT_INDEXED,
                sha256 = "oldhash001"
            )
            val insertedId = fileRepo.addDiscoveredFile(oldFile)

            // Seed B2 object directly so recovery knows bytes are already in B2
            val oldB2Key = "backups/default/$testSourceId/Docs/old_flight.txt"
            fakeStorage.uploadFileStream(
                cloudObjectPath = oldB2Key,
                inputStream = java.io.ByteArrayInputStream(contentA),
                metadata = mapOf(
                    "x-custom-sha256" to "oldhash001",
                    "x-custom-source-id" to testSourceId,
                    "x-custom-original-name" to "old_flight.txt",
                    "x-custom-file-id" to insertedId.toString()
                )
            )
            assertEquals(1, fakeStorage.uploadCount)

            // Create upload task for this file
            val task = com.usbcloudbackup.backup.model.UploadTask(
                taskId = "task-001",
                fileId = insertedId,
                b2ObjectKey = oldB2Key,
                state = com.usbcloudbackup.backup.model.UploadTaskState.UPLOADED_NOT_INDEXED,
                reservationId = "res-001",
                sha256 = "oldhash001",
                bytesTransferred = contentA.size.toLong(),
                totalBytes = contentA.size.toLong(),
                updatedAt = System.currentTimeMillis()
            )
            val uploadRepo = UploadRepository(db.uploadTaskDao())
            uploadRepo.createTask(task)

            // Run BackupWorker
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            // 1. Old in-flight job must be COMPLETED
            val recoveredJob = jobRepo.getJob(inFlightJobId)
            assertNotNull(recoveredJob)
            assertEquals(BackupJobState.COMPLETED, recoveredJob!!.state)

            // 2. Old file must be INDEXED without re-upload
            val recoveredFile = fileRepo.getFile(insertedId)
            assertNotNull(recoveredFile)
            assertEquals(FileStatus.INDEXED, recoveredFile!!.status)

            // 3. A NEW job must have been created that performed fresh discovery
            val allJobs = jobRepo.getJobsForSource(testSourceId)
            assertEquals(2, allJobs.size)
            val newJob = allJobs.first { it.jobId != inFlightJobId }
            assertEquals(BackupJobState.COMPLETED, newJob.state)

            val newJobFiles = fileRepo.getFilesForJob(newJob.jobId)
            assertTrue("New job must contain newly discovered file", newJobFiles.any { it.originalName == "new_file.txt" && it.status == FileStatus.INDEXED })
        }
    }

    @Test
    fun testAbandonedPendingReservationWithSameShaReclaimedAsSameVersion() {
        val oldJobId = "old-dead-job-versioning"
        val oldJob = BackupJob(
            jobId = oldJobId,
            sourceId = testSourceId,
            state = BackupJobState.FAILED,
            startedAt = System.currentTimeMillis() - 100000,
            completedAt = System.currentTimeMillis() - 90000
        )
        fakeFirestore.backupJobs["default_$oldJobId"] = oldJob

        val contentVersion0 = "Original eye content".toByteArray(Charsets.UTF_8)
        val sha0 = Sha256Calculator.calculateHash(java.io.ByteArrayInputStream(contentVersion0))
        val contentVersion1 = "Modified eye content".toByteArray(Charsets.UTF_8)
        val sha1 = Sha256Calculator.calculateHash(java.io.ByteArrayInputStream(contentVersion1))

        // Pre-seed version 0 as COMMITTED in fakeFirestore
        val resId0 = com.usbcloudbackup.util.ReservationUtils.encodeReservationId(testSourceId, "", "HUMAN_EYE.pdf")
        fakeFirestore.nameReservations["default_$resId0"] = mapOf(
            "reservationId" to resId0,
            "status" to "COMMITTED",
            "sha256" to sha0,
            "jobId" to "prior-job-v0",
            "storedName" to "HUMAN_EYE.pdf"
        )
        fakeFirestore.contentHashes["default_$sha0"] = mapOf("sha256" to sha0, "storedName" to "HUMAN_EYE.pdf")

        // Pre-seed abandoned PENDING reservation for HUMAN_EYE(1).pdf with sha1 from oldJobId
        val resId1 = com.usbcloudbackup.util.ReservationUtils.encodeReservationId(testSourceId, "", "HUMAN_EYE(1).pdf")
        fakeFirestore.nameReservations["default_$resId1"] = mapOf(
            "reservationId" to resId1,
            "status" to "PENDING",
            "sha256" to sha1,
            "jobId" to oldJobId,
            "storedName" to "HUMAN_EYE(1).pdf",
            "expiresAt" to System.currentTimeMillis() + 86400000L
        )

        val fakeSource = FakeStorageSource(testSourceId, "Test USB")
        fakeSource.addFile("", "HUMAN_EYE.pdf", contentVersion1)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            val b2KeyExpected = "backups/default/$testSourceId/HUMAN_EYE(1).pdf"
            assertNotNull("Reclaimed reservation should upload as HUMAN_EYE(1).pdf", fakeStorage.getStoredBytes(b2KeyExpected))

            val reservationDoc = fakeFirestore.nameReservations["default_$resId1"]
            assertNotNull(reservationDoc)
            assertEquals("COMMITTED", reservationDoc!!["status"])

            val fileDoc = fakeFirestore.files.values.firstOrNull { it["storedName"] == "HUMAN_EYE(1).pdf" }
            assertNotNull("File document for HUMAN_EYE(1).pdf should exist in Firestore", fileDoc)
            assertEquals(sha1, fileDoc!!["sha256"])
        }
    }

    @Test
    fun testAbandonedPendingReservationWithDifferentShaAdvancesToNextVersion() {
        val oldJobId = "old-dead-job-diff-sha"
        val oldJob = BackupJob(
            jobId = oldJobId,
            sourceId = testSourceId,
            state = BackupJobState.FAILED,
            startedAt = System.currentTimeMillis() - 100000
        )
        fakeFirestore.backupJobs["default_$oldJobId"] = oldJob

        val sha0 = "sha000000000000000000000000000000000000000000000000000000000000000"
        val sha1 = "sha111111111111111111111111111111111111111111111111111111111111111"
        val contentVersion2 = "Different eye content 2".toByteArray(Charsets.UTF_8)
        val sha2 = Sha256Calculator.calculateHash(java.io.ByteArrayInputStream(contentVersion2))

        val resId0 = com.usbcloudbackup.util.ReservationUtils.encodeReservationId(testSourceId, "", "HUMAN_EYE.pdf")
        fakeFirestore.nameReservations["default_$resId0"] = mapOf(
            "reservationId" to resId0,
            "status" to "COMMITTED",
            "sha256" to sha0,
            "jobId" to "prior-job-v0",
            "storedName" to "HUMAN_EYE.pdf"
        )
        fakeFirestore.contentHashes["default_$sha0"] = mapOf("sha256" to sha0, "storedName" to "HUMAN_EYE.pdf")

        val resId1 = com.usbcloudbackup.util.ReservationUtils.encodeReservationId(testSourceId, "", "HUMAN_EYE(1).pdf")
        fakeFirestore.nameReservations["default_$resId1"] = mapOf(
            "reservationId" to resId1,
            "status" to "PENDING",
            "sha256" to sha1,
            "jobId" to oldJobId,
            "storedName" to "HUMAN_EYE(1).pdf",
            "expiresAt" to System.currentTimeMillis() + 86400000L
        )

        val fakeSource = FakeStorageSource(testSourceId, "Test USB")
        fakeSource.addFile("", "HUMAN_EYE.pdf", contentVersion2)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            val b2KeyExpected = "backups/default/$testSourceId/HUMAN_EYE(2).pdf"
            assertNotNull("Different SHA must advance to HUMAN_EYE(2).pdf", fakeStorage.getStoredBytes(b2KeyExpected))

            val fileDoc = fakeFirestore.files.values.firstOrNull { it["storedName"] == "HUMAN_EYE(2).pdf" }
            assertNotNull("File document for HUMAN_EYE(2).pdf should exist in Firestore", fileDoc)
            assertEquals(sha2, fileDoc!!["sha256"])
        }
    }

    @Test
    fun testActivePendingReservationFromLiveJobIsNotStolen() {
        val liveJobId = "active-live-job-001"
        val liveJob = BackupJob(
            jobId = liveJobId,
            sourceId = testSourceId,
            state = BackupJobState.UPLOADING,
            startedAt = System.currentTimeMillis() - 1000
        )
        fakeFirestore.backupJobs["default_$liveJobId"] = liveJob

        val contentBytes = "Live job file content".toByteArray(Charsets.UTF_8)
        val sha = Sha256Calculator.calculateHash(java.io.ByteArrayInputStream(contentBytes))

        val resId0 = com.usbcloudbackup.util.ReservationUtils.encodeReservationId(testSourceId, "", "HUMAN_EYE.pdf")
        fakeFirestore.nameReservations["default_$resId0"] = mapOf(
            "reservationId" to resId0,
            "status" to "PENDING",
            "sha256" to sha,
            "jobId" to liveJobId,
            "storedName" to "HUMAN_EYE.pdf",
            "expiresAt" to System.currentTimeMillis() + 86400000L
        )

        val fakeSource = FakeStorageSource(testSourceId, "Test USB")
        fakeSource.addFile("", "HUMAN_EYE.pdf", contentBytes)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            val b2KeyExpected = "backups/default/$testSourceId/HUMAN_EYE(1).pdf"
            assertNotNull("Should advance to HUMAN_EYE(1).pdf instead of stealing live reservation", fakeStorage.getStoredBytes(b2KeyExpected))

            val liveRes = fakeFirestore.nameReservations["default_$resId0"]
            assertNotNull(liveRes)
            assertEquals(liveJobId, liveRes!!["jobId"])
            assertEquals("PENDING", liveRes["status"])
        }
    }

    @Test
    fun testReclaimedReservationCompletesB2UploadAndCommittedFinalization() {
        val oldJobId = "terminal-dead-job-004"
        val oldJob = BackupJob(
            jobId = oldJobId,
            sourceId = testSourceId,
            state = BackupJobState.COMPLETED,
            startedAt = System.currentTimeMillis() - 50000,
            completedAt = System.currentTimeMillis() - 40000
        )
        fakeFirestore.backupJobs["default_$oldJobId"] = oldJob

        val content = "Reclaim and commit test content".toByteArray(Charsets.UTF_8)
        val sha = Sha256Calculator.calculateHash(java.io.ByteArrayInputStream(content))

        val resId = com.usbcloudbackup.util.ReservationUtils.encodeReservationId(testSourceId, "Notes/", "Lecture.pdf")
        fakeFirestore.nameReservations["default_$resId"] = mapOf(
            "reservationId" to resId,
            "status" to "PENDING",
            "sha256" to sha,
            "jobId" to oldJobId,
            "storedName" to "Lecture.pdf",
            "expiresAt" to System.currentTimeMillis() + 86400000L
        )

        val fakeSource = FakeStorageSource(testSourceId, "Test USB")
        fakeSource.addFile("Notes/", "Lecture.pdf", content)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            val b2Key = "backups/default/$testSourceId/Notes/Lecture.pdf"
            assertNotNull(fakeStorage.getStoredBytes(b2Key))

            val resDoc = fakeFirestore.nameReservations["default_$resId"]
            assertNotNull(resDoc)
            assertEquals("COMMITTED", resDoc!!["status"])

            assertTrue(fakeFirestore.contentHashes.containsKey("default_$sha"))
        }
    }

    @Test
    fun testReclaimedReservationRetryRemainsIdempotent() {
        val oldJobId = "terminal-dead-job-005"
        val oldJob = BackupJob(
            jobId = oldJobId,
            sourceId = testSourceId,
            state = BackupJobState.CANCELLED,
            startedAt = System.currentTimeMillis() - 60000
        )
        fakeFirestore.backupJobs["default_$oldJobId"] = oldJob

        val content = "Idempotent retry content".toByteArray(Charsets.UTF_8)
        val sha = Sha256Calculator.calculateHash(java.io.ByteArrayInputStream(content))

        val resId = com.usbcloudbackup.util.ReservationUtils.encodeReservationId(testSourceId, "", "Doc.txt")
        fakeFirestore.nameReservations["default_$resId"] = mapOf(
            "reservationId" to resId,
            "status" to "PENDING",
            "sha256" to sha,
            "jobId" to oldJobId,
            "storedName" to "Doc.txt",
            "expiresAt" to System.currentTimeMillis() + 86400000L
        )

        val fakeSource = FakeStorageSource(testSourceId, "Test USB")
        fakeSource.addFile("", "Doc.txt", content)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            val worker1 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result1 = worker1.doWork()
            assertEquals(ListenableWorker.Result.success(), result1)

            val uploadsCount = fakeStorage.uploadCount
            assertEquals(1, uploadsCount)

            val worker2 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result2 = worker2.doWork()
            assertEquals(ListenableWorker.Result.success(), result2)

            assertEquals(1, fakeStorage.uploadCount)
            assertEquals(1, fakeFirestore.files.size)
        }
    }

    @Test
    fun testUniversalAutoUploadForMp4Mp3ZipAndUnknownExtension() {
        val fakeSource = FakeStorageSource(testSourceId, "Universal USB")
        fakeSource.addFile("Media/Videos/", "movie.mp4", "mp4 movie content".toByteArray())
        fakeSource.addFile("Media/Music/", "song.mp3", "mp3 audio content".toByteArray())
        fakeSource.addFile("Archives/", "bundle.zip", "zip archive content".toByteArray())
        fakeSource.addFile("Custom/", "model.unknownext", "custom binary content".toByteArray())
        fakeSource.addFile("", "README", "readme text content".toByteArray())

        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            // All 5 files must be uploaded to B2
            assertEquals(5, fakeStorage.uploadCount)

            val expectedKeys = listOf(
                "backups/default/$testSourceId/Media/Videos/movie.mp4",
                "backups/default/$testSourceId/Media/Music/song.mp3",
                "backups/default/$testSourceId/Archives/bundle.zip",
                "backups/default/$testSourceId/Custom/model.unknownext",
                "backups/default/$testSourceId/README"
            )
            for (key in expectedKeys) {
                assertNotNull("File $key must be uploaded to storage", fakeStorage.getStoredBytes(key))
            }

            // Verify all 5 files in Firestore have status = UPLOADED and backupMode = AUTOMATIC
            assertEquals(5, fakeFirestore.files.size)
            for (fileDoc in fakeFirestore.files.values) {
                assertEquals("UPLOADED", fileDoc["status"])
                assertEquals("AUTOMATIC", fileDoc["backupMode"])
            }
        }
    }

    @Test
    fun testMp4DeduplicationAndVersioning() {
        val contentA = "original mp4 content A".toByteArray()
        val contentB = "modified mp4 content B".toByteArray()

        val fakeSource = FakeStorageSource(testSourceId, "Video USB")
        fakeSource.addFile("Videos/", "clip.mp4", contentA)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            // Run 1: Initial upload of clip.mp4
            val worker1 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result1 = worker1.doWork()
            assertEquals(ListenableWorker.Result.success(), result1)
            assertEquals(1, fakeStorage.uploadCount)
            assertNotNull(fakeStorage.getStoredBytes("backups/default/$testSourceId/Videos/clip.mp4"))

            // Run 2: Re-scan with identical content A -> Deduplication skip
            val worker2 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result2 = worker2.doWork()
            assertEquals(ListenableWorker.Result.success(), result2)
            assertEquals("Duplicate content must NOT be re-uploaded", 1, fakeStorage.uploadCount)

            // Run 3: Modify content to B -> Versioning to clip(1).mp4
            fakeSource.addFile("Videos/", "clip.mp4", contentB)
            val worker3 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()
            val result3 = worker3.doWork()
            assertEquals(ListenableWorker.Result.success(), result3)

            assertEquals("New version must be uploaded to B2", 2, fakeStorage.uploadCount)
            assertNotNull(fakeStorage.getStoredBytes("backups/default/$testSourceId/Videos/clip(1).mp4"))

            // Verify Firestore records
            val clip0 = fakeFirestore.files.values.find { it["storedName"] == "clip.mp4" }
            assertNotNull(clip0)
            assertEquals("UPLOADED", clip0?.get("status"))

            val clip1 = fakeFirestore.files.values.find { it["storedName"] == "clip(1).mp4" }
            assertNotNull(clip1)
            assertEquals("UPLOADED", clip1?.get("status"))
        }
    }

    @Test
    fun testUnreadableFileGracefullySkippedInWorker() {
        val fakeSource = FakeStorageSource(testSourceId, "Mixed USB")
        fakeSource.addFile("Docs/", "good.pdf", "valid pdf content".toByteArray())
        fakeSource.addFile("Videos/", "corrupt.mp4", "corrupt".toByteArray(), shouldFailOnOpen = true)
        fakeSource.addFile("Music/", "song.mp3", "valid mp3 content".toByteArray())

        BackupWorker.testStorageSourceProvider = { fakeSource }

        runBlocking {
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val result = worker.doWork()
            // Even if one file had I/O failure, the worker handles it non-fatally
            assertNotNull(result)

            // The two valid files must be successfully uploaded to B2
            assertNotNull(fakeStorage.getStoredBytes("backups/default/$testSourceId/Docs/good.pdf"))
            assertNotNull(fakeStorage.getStoredBytes("backups/default/$testSourceId/Music/song.mp3"))

            // The corrupt file must NOT crash the pipeline
            val corruptFile = db.fileDao().getFilesByStatus(FileStatus.SOURCE_UNAVAILABLE).find { it.originalName == "corrupt.mp4" }
            assertNotNull("Corrupt file should be marked SOURCE_UNAVAILABLE without crashing worker", corruptFile)
        }
    }

    @Test
    fun testExecutionBudgetExpirationYieldsRetryAndPreservesStateForResume() {
        val fakeSource = FakeStorageSource(testSourceId, "Budget USB")
        fakeSource.addFile("Docs/", "file1.txt", "content 1".toByteArray())
        fakeSource.addFile("Docs/", "file2.txt", "content 2".toByteArray())

        BackupWorker.testStorageSourceProvider = { fakeSource }
        // Force execution budget to 0ms so that after scanning, the budget expires during processing
        BackupWorker.testExecutionBudgetMs = 0L

        runBlocking {
            val worker1 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val result1 = worker1.doWork()
            // Should return retry because files remain unfinished
            assertEquals(ListenableWorker.Result.retry(), result1)

            // The job remains incomplete in Room
            val incompleteJobs = jobRepo.getIncompleteJobsForSource(testSourceId)
            assertEquals(1, incompleteJobs.size)
            val activeJob = incompleteJobs.first()
            assertTrue(activeJob.state !in listOf(BackupJobState.COMPLETED, BackupJobState.FAILED))

            // Now reset budget to normal and re-run worker
            BackupWorker.testExecutionBudgetMs = null

            val worker2 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val result2 = worker2.doWork()
            assertEquals(ListenableWorker.Result.success(), result2)

            // All files uploaded and job completed
            val updatedJob = jobRepo.getJob(activeJob.jobId)
            assertEquals(BackupJobState.COMPLETED, updatedJob?.state)
            assertNotNull(fakeStorage.getStoredBytes("backups/default/$testSourceId/Docs/file1.txt"))
            assertNotNull(fakeStorage.getStoredBytes("backups/default/$testSourceId/Docs/file2.txt"))
        }
    }

    @Test
    fun testPendingDeletionsDrainedOnWorkerStartup() {
        val fakeSource = FakeStorageSource(testSourceId, "Empty USB")
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val fakeDeletionStore = com.usbcloudbackup.cloud.storage.b2.FakePendingDeletionStore()
        val orphanKey = "backups/default/orphan-drive/stale.bin"
        fakeDeletionStore.recordPendingDeletion(orphanKey)
        BackupWorker.testPendingDeletionStoreOverride = fakeDeletionStore

        // Pre-populate orphan object in fakeStorage
        runBlocking {
            fakeStorage.uploadFileStream(
                cloudObjectPath = orphanKey,
                inputStream = "stale".byteInputStream(),
                metadata = emptyMap()
            )
            assertNotNull(fakeStorage.checkObjectExists(orphanKey))

            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            // Orphan key was drained and deleted from B2 storage
            assertTrue(fakeDeletionStore.getPendingDeletions().isEmpty())
            org.junit.Assert.assertNull(fakeStorage.checkObjectExists(orphanKey))
        }
    }

    @Test
    fun testForegroundPromotionWhenNotificationPermissionDeniedReturnsFalse() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        org.robolectric.Shadows.shadowOf(app).denyPermissions(android.Manifest.permission.POST_NOTIFICATIONS)

        runBlocking {
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val promoted = worker.promoteToForegroundIfPossible()
            assertEquals(false, promoted)
        }
    }

    @Test
    fun testForegroundPromotionHandlesSecurityExceptionGracefully() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        org.robolectric.Shadows.shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)

        val fakeSource = FakeStorageSource(testSourceId, "Empty USB")
        BackupWorker.testStorageSourceProvider = { fakeSource }
        BackupWorker.testSetForegroundOverride = {
            throw SecurityException("POST_NOTIFICATIONS or FOREGROUND_SERVICE permission denied")
        }

        runBlocking {
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val promoted = worker.promoteToForegroundIfPossible()
            assertEquals(false, promoted)

            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)
        }
    }

    @Test
    fun testForegroundPromotionHandlesIllegalStateExceptionGracefully() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        org.robolectric.Shadows.shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)

        val fakeSource = FakeStorageSource(testSourceId, "Empty USB")
        BackupWorker.testStorageSourceProvider = { fakeSource }
        BackupWorker.testSetForegroundOverride = {
            throw IllegalStateException("ForegroundServiceStartNotAllowedException: Service.startForeground() not allowed")
        }

        runBlocking {
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val promoted = worker.promoteToForegroundIfPossible()
            assertEquals(false, promoted)

            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)
        }
    }

    @Test(expected = AssertionError::class)
    fun testForegroundPromotionDoesNotSwallowAssertionError() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        org.robolectric.Shadows.shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)

        BackupWorker.testSetForegroundOverride = {
            throw AssertionError("Fatal assertion failure")
        }

        runBlocking {
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            worker.promoteToForegroundIfPossible()
        }
    }

    @Test(expected = OutOfMemoryError::class)
    fun testForegroundPromotionDoesNotSwallowOutOfMemoryError() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        org.robolectric.Shadows.shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)

        BackupWorker.testSetForegroundOverride = {
            throw OutOfMemoryError("Simulated OOM")
        }

        runBlocking {
            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            worker.promoteToForegroundIfPossible()
        }
    }

    @Test
    fun testJitDeduplicationSkipsAndCleansUpReservation() = runBlocking {
        val fakeSource = FakeStorageSource(testSourceId, "Worker Test USB")
        val contentBytes = "Identical payload content".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("Docs/", "File1.txt", contentBytes)
        fakeSource.addFile("Photos/", "File2.txt", contentBytes)

        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        val result = worker.doWork()
        assertEquals(ListenableWorker.Result.success(), result)

        val jobs = jobRepo.getJobsForSource(testSourceId)
        assertEquals(1, jobs.size)
        val files = fileRepo.getFilesForJob(jobs[0].jobId)
        assertEquals(2, files.size)

        val indexedCount = files.count { it.status == FileStatus.INDEXED }
        val skippedCount = files.count { it.status == FileStatus.SKIPPED_DUPLICATE }
        assertEquals(1, indexedCount)
        assertEquals(1, skippedCount)

        assertEquals(1, fakeStorage.getStoredObjectCount())
        assertEquals(1, jobs[0].skippedFiles)
    }

    @Test
    fun testUsbDetachBroadcastCancelsWorker() {
        val fakeSource = object : FakeStorageSource(testSourceId, "Worker Test USB") {
            override suspend fun isAvailable(): Boolean = true
            override suspend fun discoverFiles(): List<com.usbcloudbackup.storage.DiscoveredFileDescriptor> {
                val intent = android.content.Intent(android.hardware.usb.UsbManager.ACTION_USB_DEVICE_DETACHED)
                context.sendBroadcast(intent)
                ShadowLooper.idleMainLooper()
                return emptyList()
            }
        }

        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        try {
            val result = runBlocking { worker.doWork() }
            assertTrue(result == ListenableWorker.Result.failure() || result == ListenableWorker.Result.retry())
        } catch (e: Throwable) {
            // Expected cancellation: worker coroutine cancelled by USB detach broadcast
            assertTrue("Expected CancellationException but got ${e::class.java.name}",
                e is java.util.concurrent.CancellationException || e is kotlinx.coroutines.CancellationException)
        }
    }
}
