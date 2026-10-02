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
import com.usbcloudbackup.backup.model.UploadTask
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.storage.FakeCloudStorageRepository
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.database.AppDatabase
import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.storage.StorageVolume
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReconciliationWorkerTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var fileRepo: FileRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var fakeAuth: AuthRepository

    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val testSourceId = "usb-reconcile-001"
    private val testJobId = "job-reconcile-001"

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        AppDatabase.setTestInstance(db)
        fileRepo = FileRepository(db.fileDao())

        fakeFirestore = FakeFirestoreRepository()
        fakeStorage = FakeCloudStorageRepository()

        fakeAuth = object : AuthRepository {
            override fun getCurrentUid(): String = "daemon_reconcile_001"
            override fun isAuthenticated(): Boolean = true
            override suspend fun ensureAuthenticated(): String = "daemon_reconcile_001"
            override fun getAuthMethod(): String = "anonymous"
        }

        ReconciliationWorker.testAuthRepositoryOverride = fakeAuth
        ReconciliationWorker.testFirestoreRepositoryOverride = fakeFirestore
        ReconciliationWorker.testCloudStorageRepositoryOverride = fakeStorage
    }

    @After
    fun tearDown() {
        ReconciliationWorker.testAuthRepositoryOverride = null
        ReconciliationWorker.testFirestoreRepositoryOverride = null
        ReconciliationWorker.testCloudStorageRepositoryOverride = null
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = null
        com.usbcloudbackup.storage.SourceIdResolver.testMountedStorageDirectoriesProvider = null
        com.usbcloudbackup.storage.SourceIdResolver.clearMappingsForTesting()
        AppDatabase.setTestInstance(null)
        db.close()
        fakeFirestore.clear()
        fakeStorage.clear()
    }

    @Test
    fun testReconciliationWorkerReconcilesUploadedNotIndexedTasks() {
        runBlocking {
            val source = UsbSource(testSourceId, 111, 222, "SN_REC", "VOL_REC", "Reconcile USB", 1000L, 2000L)
            db.sourceDao().insertSource(source.toEntity())
            val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
            db.backupJobDao().insertJob(job.toEntity())

            val sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            val b2Key = "backups/$vaultId/$testSourceId/Docs/FileRec.pdf"
            val taskId = "task-rec-999"

            val file = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Docs/",
                originalName = "FileRec.pdf",
                sha256 = sha256,
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.NAME_RESERVED
            )
            val fileId = fileRepo.addDiscoveredFile(file)
            fileRepo.updateFileStatus(fileId, FileStatus.UPLOADING)
            fileRepo.updateFileStatus(fileId, FileStatus.UPLOADED_NOT_INDEXED)

            val task = UploadTask(
                taskId = taskId,
                fileId = fileId,
                state = UploadTaskState.UPLOADED_NOT_INDEXED,
                b2ObjectKey = b2Key,
                uploadSessionUri = null,
                reservationId = "res-rec-999",
                sha256 = sha256,
                bytesTransferred = 100L,
                totalBytes = 100L,
                updatedAt = System.currentTimeMillis()
            )
            db.uploadTaskDao().insertTask(task.toEntity())

            // Pre-stage Cloud Storage object and Firestore reservation
            fakeStorage.uploadFileStream(
                cloudObjectPath = b2Key,
                inputStream = ByteArrayInputStream("Reconcile bytes".toByteArray(Charsets.UTF_8)),
                metadata = mapOf("x-custom-sha256" to sha256)
            )

            fakeFirestore.reserveCloudFilename(vaultId, testSourceId, "Docs/", "FileRec.pdf", sha256, testJobId, taskId)

            val worker = TestListenableWorkerBuilder<ReconciliationWorker>(context).build()
            val result = worker.doWork()

            assertEquals(ListenableWorker.Result.success(), result)

            // Verify status transitioned to INDEXED
            val updatedFile = fileRepo.getFile(fileId)
            assertEquals(FileStatus.INDEXED, updatedFile?.status)

            val updatedTask = db.uploadTaskDao().getTaskById(taskId)
            assertNotNull(updatedTask)
            assertEquals(UploadTaskState.INDEXED, updatedTask?.state)
        }
    }

    @Test
    fun testReconciliationWorkerReconcilesInterruptedUploadingTaskWhenObjectExistsInB2() = runBlocking {
        val source = UsbSource(testSourceId, 111, 222, "SN_REC2", "VOL_REC2", "Reconcile USB 2", 1000L, 2000L)
        db.sourceDao().insertSource(source.toEntity())
        val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
        db.backupJobDao().insertJob(job.toEntity())

        val sha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        val b2Key = "backups/$vaultId/$testSourceId/Docs/Interrupted.pdf"
        val taskId = "task-interrupted-001"
        val contentBytes = "Interrupted upload content".toByteArray(Charsets.UTF_8)

        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "Interrupted.pdf",
            sha256 = sha256,
            size = contentBytes.size.toLong(),
            lastModified = 1000L,
            status = FileStatus.NAME_RESERVED
        )
        val fileId = fileRepo.addDiscoveredFile(file)
        fileRepo.updateFileStatus(fileId, FileStatus.UPLOADING)

        val task = UploadTask(
            taskId = taskId,
            fileId = fileId,
            state = UploadTaskState.UPLOADING,
            b2ObjectKey = b2Key,
            uploadSessionUri = null,
            reservationId = "res-interrupted-001",
            sha256 = sha256,
            bytesTransferred = contentBytes.size.toLong(),
            totalBytes = contentBytes.size.toLong(),
            updatedAt = System.currentTimeMillis()
        )
        db.uploadTaskDao().insertTask(task.toEntity())

        // Pre-stage Cloud Storage object as if upload finished right before process died
        fakeStorage.uploadFileStream(
            cloudObjectPath = b2Key,
            inputStream = ByteArrayInputStream(contentBytes),
            metadata = mapOf("x-custom-sha256" to sha256)
        )

        fakeFirestore.reserveCloudFilename(vaultId, testSourceId, "Docs/", "Interrupted.pdf", sha256, testJobId, taskId)

        val worker = TestListenableWorkerBuilder<ReconciliationWorker>(context).build()
        val result = worker.doWork()

        assertEquals(ListenableWorker.Result.success(), result)

        val updatedFile = fileRepo.getFile(fileId)
        assertEquals(FileStatus.INDEXED, updatedFile?.status)

        val updatedTask = db.uploadTaskDao().getTaskById(taskId)
        assertEquals(UploadTaskState.INDEXED, updatedTask?.state)
    }

    @Test
    fun testReconciliationWorkerResetsInterruptedUploadingTaskWhenObjectMissingInB2() = runBlocking {
        val source = UsbSource(testSourceId, 111, 222, "SN_REC3", "VOL_REC3", "Reconcile USB 3", 1000L, 2000L)
        db.sourceDao().insertSource(source.toEntity())
        val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
        db.backupJobDao().insertJob(job.toEntity())

        val sha256 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
        val b2Key = "backups/$vaultId/$testSourceId/Docs/MissingOnB2.pdf"
        val taskId = "task-missing-001"

        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "MissingOnB2.pdf",
            sha256 = sha256,
            size = 500L,
            lastModified = 1000L,
            status = FileStatus.NAME_RESERVED
        )
        val fileId = fileRepo.addDiscoveredFile(file)
        fileRepo.updateFileStatus(fileId, FileStatus.UPLOADING)

        val task = UploadTask(
            taskId = taskId,
            fileId = fileId,
            state = UploadTaskState.UPLOADING,
            b2ObjectKey = b2Key,
            uploadSessionUri = null,
            reservationId = "res-missing-001",
            sha256 = sha256,
            bytesTransferred = 100L,
            totalBytes = 500L,
            updatedAt = System.currentTimeMillis()
        )
        db.uploadTaskDao().insertTask(task.toEntity())

        // Do not upload to fakeStorage (object is missing or incomplete)

        val worker = TestListenableWorkerBuilder<ReconciliationWorker>(context).build()
        val result = worker.doWork()

        assertEquals(ListenableWorker.Result.success(), result)

        val updatedFile = fileRepo.getFile(fileId)
        assertEquals(FileStatus.SOURCE_UNAVAILABLE, updatedFile?.status)
    }

    @Test
    fun testReconciliationWorkerWhenUsbAttachedButVolumeUnmountedDoesNotEnqueueBackup() = runBlocking {
        val usbManager = mockk<UsbManager>(relaxed = true)
        val usbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "TEST_SN_REC_UNMOUNTED"
            every { deviceClass } returns UsbConstants.USB_CLASS_MASS_STORAGE
        }
        every { usbManager.deviceList } returns hashMapOf("dev1" to usbDevice)

        val shadowContext = org.robolectric.Shadows.shadowOf(context as android.app.Application)
        shadowContext.setSystemService(Context.USB_SERVICE, usbManager)

        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { emptyList() }

        val worker = TestListenableWorkerBuilder<ReconciliationWorker>(context).build()
        val result = worker.doWork()

        assertEquals(ListenableWorker.Result.success(), result)

        val workKey = BackupWorkManager.getUniqueWorkName(context, "1008-8195-TEST_SN_REC_UNMOUNTED", usbDevice)
        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(workKey)
            .get()

        assertTrue(workInfos.isEmpty())
        val allBackupWork = WorkManager.getInstance(context).getWorkInfosByTag("backup_worker").get()
        assertTrue(allBackupWork.isEmpty())
    }

    @Test
    fun testReconciliationWorkerWhenUsbAttachedAndVolumeMountedEnqueuesSingleBackupWithMountedCanonicalSourceId() = runBlocking {
        val usbManager = mockk<UsbManager>(relaxed = true)
        val usbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "TEST_SN_REC_MOUNTED"
            every { deviceClass } returns UsbConstants.USB_CLASS_MASS_STORAGE
        }
        every { usbManager.deviceList } returns hashMapOf("dev1" to usbDevice)

        val shadowContext = org.robolectric.Shadows.shadowOf(context as android.app.Application)
        shadowContext.setSystemService(Context.USB_SERVICE, usbManager)

        val mockStorageVolume = mockk<StorageVolume>(relaxed = true) {
            every { isRemovable } returns true
            every { isPrimary } returns false
            every { uuid } returns "0CF3-4237"
            every { state } returns android.os.Environment.MEDIA_MOUNTED
        }
        com.usbcloudbackup.storage.SourceIdResolver.testStorageVolumesProvider = { listOf(mockStorageVolume) }

        val worker = TestListenableWorkerBuilder<ReconciliationWorker>(context).build()
        val result = worker.doWork()

        assertEquals(ListenableWorker.Result.success(), result)

        val expectedCanonicalSourceId = "1008-8195-0CF3-4237"
        val workKey = BackupWorkManager.getUniqueWorkName(context, expectedCanonicalSourceId, usbDevice)
        assertEquals("backup_1008-8195-TEST_SN_REC_MOUNTED", workKey)

        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(workKey)
            .get()

        assertEquals(1, workInfos.size)

        val canonicalId = com.usbcloudbackup.storage.SourceIdResolver.resolveMountedCanonicalSourceId(context, usbDevice)
        assertEquals("1008-8195-0CF3-4237", canonicalId)
        assertFalse(com.usbcloudbackup.storage.SourceIdResolver.isRawHardwareId(canonicalId!!))
    }
}
