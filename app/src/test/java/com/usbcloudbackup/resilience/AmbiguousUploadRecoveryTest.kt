package com.usbcloudbackup.resilience

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UploadTask
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
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
class AmbiguousUploadRecoveryTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var sourceRepo: SourceRepository
    private lateinit var jobRepo: BackupJobRepository
    private lateinit var fileRepo: FileRepository
    private lateinit var uploadRepo: UploadRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var fakeAuth: AuthRepository

    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val testUid = "ambiguous_user_001"
    private val testSourceId = "usb-ambiguous-001"
    private val testJobId = "job-ambiguous-001"

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
        uploadRepo = UploadRepository(db.uploadTaskDao())

        fakeFirestore = FakeFirestoreRepository()
        fakeStorage = FakeCloudStorageRepository()

        fakeAuth = object : AuthRepository {
            override fun getCurrentUid(): String = testUid
            override fun isAuthenticated(): Boolean = true
            override suspend fun ensureAuthenticated(): String = testUid
            override fun getAuthMethod(): String = "anonymous"
        }

        runBlocking {
            val source = UsbSource(testSourceId, 33, 44, "SN_AMB", "VOL_AMB", "Amb Drive", 1000L, 2000L)
            sourceRepo.saveSource(source)
            val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
            jobRepo.createJob(job)
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
    fun testAmbiguousCloudUploadBypassesByteReUploadAndFinalizesFirestore() = runBlocking {
        val sha256 = "2222222222222222222222222222222222222222222222222222222222222222"
        val b2Key = "backups/$vaultId/$testSourceId/Docs/AmbiguousDoc.pdf"
        val taskId = "task-amb-001"

        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "AmbiguousDoc.pdf",
            sha256 = sha256,
            size = 300L,
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
            reservationId = "res-amb-001",
            sha256 = sha256,
            bytesTransferred = 300L,
            totalBytes = 300L,
            updatedAt = System.currentTimeMillis()
        )
        uploadRepo.createTask(task)

        // Pre-stage object in Cloud Storage (simulating network timeout after server accepted bytes)
        fakeStorage.uploadFileStream(
            cloudObjectPath = b2Key,
            inputStream = ByteArrayInputStream("Ambiguous content bytes".toByteArray(Charsets.UTF_8)),
            metadata = mapOf("x-custom-sha256" to sha256)
        )
        fakeFirestore.reserveCloudFilename(vaultId, testSourceId, "Docs/", "AmbiguousDoc.pdf", sha256, testJobId, taskId)

        val initialUploads = fakeStorage.uploadCount

        val recoveryEngine = CloudRecoveryEngine(fileRepo, jobRepo, uploadRepo, fakeFirestore, fakeStorage)

        val success = recoveryEngine.processOrRecoverUpload(
            vaultId = vaultId,
            file = fileRepo.getFile(fileId)!!,
            task = uploadRepo.getTaskForFile(fileId)!!,
            inputStreamProvider = { ByteArrayInputStream(ByteArray(0)) }
        )

        assertTrue(success)

        // Verify status reached INDEXED
        val finalFile = fileRepo.getFile(fileId)
        assertEquals(FileStatus.INDEXED, finalFile?.status)

        // Verify no additional byte uploads were made
        assertEquals(initialUploads, fakeStorage.uploadCount)

        // Verify Firestore records
        assertTrue(fakeFirestore.isContentHashIndexed(vaultId, sha256))
        assertEquals(1, fakeFirestore.files.size)
        val firstFileDoc = fakeFirestore.files.values.first()
        assertEquals("AmbiguousDoc.pdf", firstFileDoc["originalName"])
    }
}
