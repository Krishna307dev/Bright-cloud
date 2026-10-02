package com.usbcloudbackup.worker

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
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
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UsbDetachAndReinsertRegressionTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var jobRepo: BackupJobRepository
    private lateinit var fileRepo: FileRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var fakeAuth: AuthRepository

    private val testSourceId = "usb-detach-reinsert-001"

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)

        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        AppDatabase.setTestInstance(db)

        jobRepo = BackupJobRepository(db.backupJobDao())
        fileRepo = FileRepository(db.fileDao())

        fakeFirestore = FakeFirestoreRepository()
        fakeStorage = FakeCloudStorageRepository()

        fakeAuth = object : AuthRepository {
            override fun getCurrentUid(): String = "test_detach_uid"
            override fun isAuthenticated(): Boolean = true
            override suspend fun ensureAuthenticated(): String = "test_detach_uid"
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

    @Test
    fun testDetachDuringScanAbortsCleanlyWithoutInfiniteRetry() = runBlocking {
        val fakeSource = FakeStorageSource(testSourceId, "Scan Detach Drive")
        fakeSource.setAvailable(false) // Storage detached before scan
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        val result = worker.doWork()
        // Must return failure to avoid infinite retry loop
        assertEquals(ListenableWorker.Result.failure(), result)
    }

    @Test
    fun testDetachDuringHashingMarksFileSourceUnavailableAndAborts() = runBlocking {
        val fakeSource = FakeStorageSource(testSourceId, "Hash Detach Drive")
        fakeSource.addFile("Docs/", "CorruptedDetach.pdf", "data".toByteArray(), shouldFailOnOpen = true)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        val result = worker.doWork()
        // Hashing I/O error marks file as SOURCE_UNAVAILABLE and completes pipeline cleanly
        val jobs = jobRepo.getJobsForSource(testSourceId)
        assertEquals(1, jobs.size)
        val files = fileRepo.getFilesForJob(jobs[0].jobId)
        assertEquals(1, files.size)
        assertEquals(FileStatus.SOURCE_UNAVAILABLE, files[0].status)
    }

    @Test
    fun testDetachDuringUploadStopsLoopAndMarksSourceUnavailable() = runBlocking {
        val fakeSource = FakeStorageSource(testSourceId, "Upload Detach Drive")
        fakeSource.detachOnSecondOpen = true
        fakeSource.addFile("Videos/", "HomeVideo.mp4", "Sample Video Bytes".toByteArray(), shouldFailOnOpen = false)
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        // Worker stops cleanly
        val result = worker.doWork()
        assertNotNull(result)

        val jobs = jobRepo.getJobsForSource(testSourceId)
        assertEquals(1, jobs.size)
        val files = fileRepo.getFilesForJob(jobs[0].jobId)
        assertEquals(1, files.size)
        assertEquals(FileStatus.SOURCE_UNAVAILABLE, files[0].status)
    }

    @Test
    fun testDetachAfterB2UploadBeforeFirestoreFinalizationRecoversOnReinsert() = runBlocking {
        // Satisfy foreign key constraint on backup_jobs
        val sourceEntity = com.usbcloudbackup.database.entity.SourceEntity(
            sourceId = testSourceId,
            usbVendorId = 1234,
            usbProductId = 5678,
            serialNumber = "SN_RECOVER_01",
            volumeUuid = "UUID_RECOVER_01",
            displayName = "USB Drive",
            firstSeen = System.currentTimeMillis(),
            lastSeen = System.currentTimeMillis()
        )
        db.sourceDao().insertSource(sourceEntity)

        val initialJobId = UUID.randomUUID().toString()
        jobRepo.createJob(BackupJob(initialJobId, testSourceId, BackupJobState.UPLOADING, System.currentTimeMillis()))

        val testSha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        val pendingEntity = FileEntity(
            jobId = initialJobId,
            sourceId = testSourceId,
            relativePath = "Reports/",
            originalName = "AnnualReport.pdf",
            extension = "pdf",
            size = 1024L,
            lastModified = 1000L,
            sha256 = testSha,
            status = FileStatus.UPLOADED_NOT_INDEXED,
            cloudFilename = "AnnualReport.pdf",
            b2ObjectKey = "backups/default/$testSourceId/Reports/AnnualReport.pdf",
            backupMode = BackupMode.AUTOMATIC.name
        )
        val fileId = db.fileDao().insertFile(pendingEntity)

        // The object already exists in B2 (since B2 upload finished before USB was pulled)
        fakeStorage.uploadFileStream(
            cloudObjectPath = "backups/default/$testSourceId/Reports/AnnualReport.pdf",
            inputStream = java.io.ByteArrayInputStream("Report data".toByteArray()),
            metadata = mapOf("x-custom-sha256" to testSha)
        )

        // USB drive is re-inserted with the same file
        val reinsertedSource = FakeStorageSource(testSourceId, "Reinserted USB")
        reinsertedSource.addFile("Reports/", "AnnualReport.pdf", "Report data".toByteArray())
        BackupWorker.testStorageSourceProvider = { reinsertedSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        val result = worker.doWork()
        assertEquals(ListenableWorker.Result.success(), result)

        // Verify that Phase 1 recovered the UPLOADED_NOT_INDEXED file to INDEXED
        val recoveredFile = fileRepo.getFile(fileId)
        assertNotNull(recoveredFile)
        assertEquals(FileStatus.INDEXED, recoveredFile!!.status)

        // Verify Firestore was finalized
        val indexedInCloud = fakeFirestore.isContentHashIndexed("default", testSha)
        assertTrue(indexedInCloud)
    }

    @Test
    fun testImmediateReinsertBypassesStaleUniqueWorkAndProcessesFreshContents() = runBlocking {
        // Enqueue unique work with REPLACE policy
        BackupWorkManager.enqueueBackup(context, testSourceId)

        val uniqueWorkName = BackupWorkManager.getUniqueWorkName(testSourceId)
        val workInfos1 = WorkManager.getInstance(context).getWorkInfosForUniqueWork(uniqueWorkName).get()
        assertFalse(workInfos1.isEmpty())

        // Reinserting USB triggers enqueueBackup again
        BackupWorkManager.enqueueBackup(context, testSourceId)

        val workInfos2 = WorkManager.getInstance(context).getWorkInfosForUniqueWork(uniqueWorkName).get()
        assertFalse(workInfos2.isEmpty())

        // Run worker with new file contents
        val fakeSource = FakeStorageSource(testSourceId, "Fresh Pendrive")
        fakeSource.addFile("Notes/", "FreshNote.txt", "Fresh Content".toByteArray())
        BackupWorker.testStorageSourceProvider = { fakeSource }

        val worker = TestListenableWorkerBuilder<BackupWorker>(context)
            .setInputData(androidx.work.workDataOf(BackupWorkManager.KEY_SOURCE_ID to testSourceId))
            .build()

        val result = worker.doWork()
        assertEquals(ListenableWorker.Result.success(), result)

        val jobs = jobRepo.getJobsForSource(testSourceId)
        val files = fileRepo.getFilesForJob(jobs.last().jobId)
        assertTrue(files.any { it.originalName == "FreshNote.txt" && it.status == FileStatus.INDEXED })
    }
}
