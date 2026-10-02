package com.usbcloudbackup.resilience

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.VersionedNameResolver
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UploadTask
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.SourceRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.recovery.CloudRecoveryEngine
import com.usbcloudbackup.cloud.storage.FakeCloudStorageRepository
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.database.AppDatabase
import java.io.ByteArrayInputStream
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ProcessDeathRecoveryTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var sourceRepo: SourceRepository
    private lateinit var jobRepo: BackupJobRepository
    private lateinit var fileRepo: FileRepository
    private lateinit var reservationRepo: ReservationRepository
    private lateinit var uploadRepo: UploadRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var fakeAuth: AuthRepository

    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val testUid = "death_test_user_001"
    private val testSourceId = "usb-death-source-001"
    private val testJobId = "job-death-001"

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        AppDatabase.setTestInstance(db)

        sourceRepo = SourceRepository(db.sourceDao())
        jobRepo = BackupJobRepository(db.backupJobDao())
        fileRepo = FileRepository(db.fileDao())
        reservationRepo = ReservationRepository(db.nameReservationDao())
        uploadRepo = UploadRepository(db.uploadTaskDao())

        fakeFirestore = FakeFirestoreRepository()
        fakeStorage = FakeCloudStorageRepository()

        fakeAuth = object : AuthRepository {
            override fun getCurrentUid(): String = testUid
            override fun isAuthenticated(): Boolean = true
            override suspend fun ensureAuthenticated(): String = testUid
            override fun getAuthMethod(): String = "anonymous"
        }
    }

    @After
    fun tearDown() {
        AppDatabase.setTestInstance(null)
        db.close()
        fakeFirestore.clear()
        fakeStorage.clear()
    }

    @Test
    fun testProcessDeathAfterStorageUploadBeforeFirestoreFinalization() = runBlocking {
        // Setup initial pre-death state
        val source = UsbSource(testSourceId, 100, 200, "SN_DEATH", "VOL_DEATH", "Death Drive", 1000L, 2000L)
        sourceRepo.saveSource(source)

        val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
        jobRepo.createJob(job)

        val sha256 = "1111111111111111111111111111111111111111111111111111111111111111"
        val b2Key = "backups/$vaultId/$testSourceId/Docs/DeathReport.pdf"
        val taskId = "task-death-001"

        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "DeathReport.pdf",
            sha256 = sha256,
            size = 500L,
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
            reservationId = "res-death-001",
            sha256 = sha256,
            bytesTransferred = 500L,
            totalBytes = 500L,
            updatedAt = System.currentTimeMillis()
        )
        uploadRepo.createTask(task)

        // Simulate pre-existing Cloud Storage object uploaded before process death
        fakeStorage.uploadFileStream(
            cloudObjectPath = b2Key,
            inputStream = ByteArrayInputStream("Death bytes".toByteArray(Charsets.UTF_8)),
            metadata = mapOf("x-custom-sha256" to sha256)
        )
        fakeFirestore.reserveCloudFilename(vaultId, testSourceId, "Docs/", "DeathReport.pdf", sha256, testJobId, taskId)

        val initialUploadCount = fakeStorage.uploadCount

        // SIMULATE PROCESS RESTART: Create new recovery engine using same DB and cloud state
        val recoveryEngine = CloudRecoveryEngine(fileRepo, jobRepo, uploadRepo, fakeFirestore, fakeStorage)

        val recoveredFile = fileRepo.getFile(fileId)!!
        val recoveredTask = uploadRepo.getTaskForFile(fileId)!!

        val success = recoveryEngine.processOrRecoverUpload(
            vaultId = vaultId,
            file = recoveredFile,
            task = recoveredTask,
            inputStreamProvider = { ByteArrayInputStream(ByteArray(0)) }
        )

        assertTrue(success)

        // Verify state transitioned to INDEXED
        val finalFile = fileRepo.getFile(fileId)
        assertEquals(FileStatus.INDEXED, finalFile?.status)

        val finalTask = uploadRepo.getTaskForFile(fileId)
        assertEquals(UploadTaskState.INDEXED, finalTask?.state)

        // Verify zero additional byte uploads occurred
        assertEquals(initialUploadCount, fakeStorage.uploadCount)

        // Verify Firestore index document exists
        assertTrue(fakeFirestore.isContentHashIndexed(vaultId, sha256))
    }
}
