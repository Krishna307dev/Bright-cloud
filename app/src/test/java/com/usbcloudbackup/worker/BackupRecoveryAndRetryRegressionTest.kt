package com.usbcloudbackup.worker

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.storage.FakeCloudStorageRepository
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.database.entity.FileEntity
import com.usbcloudbackup.policy.BackupMode
import com.usbcloudbackup.storage.FakeStorageSource
import com.usbcloudbackup.storage.SourceIdResolver
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
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BackupRecoveryAndRetryRegressionTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var jobRepo: BackupJobRepository
    private lateinit var fileRepo: FileRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var fakeAuth: AuthRepository

    private val testSourceId = "1008-8195-FAC5-5D5E"

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        AppDatabase.setTestInstance(db)

        jobRepo = BackupJobRepository(db.backupJobDao())
        fileRepo = FileRepository(db.fileDao())

        fakeFirestore = FakeFirestoreRepository()
        fakeStorage = FakeCloudStorageRepository()

        fakeAuth = object : AuthRepository {
            override fun getCurrentUid(): String = "test_anon_uid"
            override fun isAuthenticated(): Boolean = true
            override suspend fun ensureAuthenticated(): String = "test_anon_uid"
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
        AppDatabase.setTestInstance(null)
        db.close()
        fakeFirestore.clear()
        fakeStorage.clear()
    }

    /**
     * Regression Test for Bug 1 & Bug 3:
     * 1. Direct B2 upload succeeds.
     * 2. Local state transitions to UPLOADED_NOT_INDEXED.
     * 3. Firestore transaction fails with "Firestore transactions require all reads to be executed before all writes".
     * 4. BackupWorker catches failure and returns Result.retry().
     * 5. On retry, BackupWorker resumes WITHOUT trying UPLOADING -> SCANNING.
     * 6. CloudRecoveryEngine detects object already in B2 and BYPASSES byte upload (no duplicate object).
     * 7. Metadata transaction is finalized.
     * 8. File moves to INDEXED and job completes.
     */
    @Test
    fun testTransactionFailureLeavesUploadedNotIndexedAndRetriesSuccessfullyWithoutDuplicateUpload() {
        val fakeSource = FakeStorageSource(testSourceId, "USB Drive")
        val contentBytes = "Chapter 5 notes content".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("Docs/", "CHAPTER 5.pdf", contentBytes)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        // Configure Firestore fake to fail the transaction the FIRST time with the exact runtime error
        fakeFirestore.failFinalizeTransactionTimes = 1

        val worker1 = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        runBlocking {
            // First execution attempt - fails at Firestore finalization
            val result1 = worker1.doWork()
            assertEquals(ListenableWorker.Result.retry(), result1)

            // Verify B2 upload succeeded
            assertEquals(1, fakeStorage.uploadCount)
            val b2Key = "backups/default/$testSourceId/Docs/CHAPTER 5.pdf"
            assertNotNull("Object must exist in B2 after successful byte upload", fakeStorage.getStoredBytes(b2Key))

            // Verify local state was preserved as UPLOADED_NOT_INDEXED
            val incompleteJobs = jobRepo.getAllIncompleteJobs()
            assertEquals(1, incompleteJobs.size)
            val files = fileRepo.getFilesForJob(incompleteJobs[0].jobId)
            assertEquals(1, files.size)
            assertEquals(FileStatus.UPLOADED_NOT_INDEXED, files[0].status)

            // Verify Firestore file metadata was NOT written yet due to transaction failure
            assertEquals(0, fakeFirestore.files.size)

            // --- NOW EXECUTE RETRY ---
            val worker2 = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            val result2 = worker2.doWork()
            assertEquals(ListenableWorker.Result.success(), result2)

            // CRITICAL INVARIANT: ZERO additional byte uploads to B2 on retry
            assertEquals("Must NOT re-upload bytes if already present in B2", 1, fakeStorage.uploadCount)

            // Verify Firestore file metadata is now committed exactly ONCE
            assertEquals(1, fakeFirestore.files.size)
            assertEquals(1, fakeFirestore.contentHashes.size)

            // Verify file status is now INDEXED and job is COMPLETED
            val finalJob = jobRepo.getJob(incompleteJobs[0].jobId)
            assertNotNull(finalJob)
            assertEquals(BackupJobState.COMPLETED, finalJob!!.state)

            val finalFiles = fileRepo.getFilesForJob(finalJob.jobId)
            assertEquals(1, finalFiles.size)
            assertEquals(FileStatus.INDEXED, finalFiles[0].status)
        }
    }

    /**
     * Regression Test for Bug 3:
     * When a job is already in UPLOADING with an unfinalized file,
     * worker retry must NOT attempt an illegal transition from UPLOADING to SCANNING.
     */
    @Test
    fun testRetryDoesNotAttemptIllegalUploadingToScanningTransition() {
        val fakeSource = FakeStorageSource(testSourceId, "USB Drive")
        fakeSource.addFile("Docs/", "CHAPTER 5.pdf", "content".toByteArray(Charsets.UTF_8))
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val jobId = UUID.randomUUID().toString()
        runBlocking {
            // Seed existing source to satisfy foreign key constraint
            val sourceRepo = com.usbcloudbackup.backup.repository.SourceRepository(db.sourceDao())
            sourceRepo.saveSource(
                com.usbcloudbackup.backup.model.UsbSource(
                    sourceId = testSourceId,
                    usbVendorId = 1008,
                    usbProductId = 8195,
                    serialNumber = null,
                    volumeUuid = "FAC5-5D5E",
                    displayName = "USB Drive",
                    firstSeen = 1000L,
                    lastSeen = 1000L
                )
            )

            // Seed existing job in UPLOADING state
            val existingJob = BackupJob(
                jobId = jobId,
                sourceId = testSourceId,
                state = BackupJobState.UPLOADING,
                startedAt = System.currentTimeMillis()
            )
            jobRepo.createJob(existingJob)

            // Seed existing file in UPLOADED_NOT_INDEXED
            db.fileDao().insertFile(
                FileEntity(
                    sourceId = testSourceId,
                    jobId = jobId,
                    relativePath = "Docs/",
                    originalName = "CHAPTER 5.pdf",
                    size = 100L,
                    lastModified = 1000L,
                    status = FileStatus.UPLOADED_NOT_INDEXED,
                    sha256 = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                    backupMode = BackupMode.AUTOMATIC.name
                )
            )

            // Pre-seed object in B2
            fakeStorage.uploadFileStream(
                cloudObjectPath = "backups/default/$testSourceId/Docs/CHAPTER 5.pdf",
                inputStream = "content".byteInputStream(),
                metadata = mapOf("x-custom-sha256" to "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
            )

            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
                .build()

            // Executing retry must NOT throw IllegalStateException("Illegal BackupJobState transition from UPLOADING to SCANNING")
            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            val job = jobRepo.getJob(jobId)
            assertNotNull(job)
            assertEquals(BackupJobState.COMPLETED, job!!.state)
        }
    }
}
