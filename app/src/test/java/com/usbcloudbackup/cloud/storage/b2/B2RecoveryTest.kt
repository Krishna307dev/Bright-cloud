package com.usbcloudbackup.cloud.storage.b2

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
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
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.recovery.CloudRecoveryEngine
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.database.AppDatabase
import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class B2RecoveryTest {

    private lateinit var db: AppDatabase
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var uploadRepository: UploadRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeB2Storage: FakeB2StorageRepository
    private lateinit var recoveryEngine: CloudRecoveryEngine

    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val testSourceId = "src-sandisk-b2"
    private val testJobId = "job-b2-001"

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        fileRepository = FileRepository(db.fileDao())
        jobRepository = BackupJobRepository(db.backupJobDao())
        uploadRepository = UploadRepository(db.uploadTaskDao())

        fakeFirestore = FakeFirestoreRepository()
        fakeB2Storage = FakeB2StorageRepository()

        recoveryEngine = CloudRecoveryEngine(
            fileRepository = fileRepository,
            jobRepository = jobRepository,
            uploadRepository = uploadRepository,
            firestoreRepository = fakeFirestore,
            cloudStorageRepository = fakeB2Storage
        )

        runBlocking {
            val source = UsbSource(testSourceId, 111, 222, "SN_B2", "VOL_B2", "B2 USB", 1000L, 2000L)
            db.sourceDao().insertSource(source.toEntity())
            val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
            jobRepository.createJob(job)
        }
    }

    @After
    fun tearDown() {
        db.close()
        fakeFirestore.clear()
    }

    @Test
    fun testUploadedNotIndexedRecoveryDoesNotReuploadBytesToB2() = runBlocking {
        val sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val contentBytes = "Backblaze B2 Pre-existing Content".toByteArray(Charsets.UTF_8)

        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Notes/",
            originalName = "lecture.pdf",
            sha256 = sha256,
            size = contentBytes.size.toLong(),
            lastModified = 1000L,
            status = FileStatus.HASHED
        )
        val fileId = fileRepository.addDiscoveredFile(file)

        val taskId = "task-b2-rec-1"
        val resId = "res-b2-rec-1"
        val b2Key = "backups/$vaultId/$testSourceId/Notes/lecture.pdf"

        // Pre-reserve in Firestore
        fakeFirestore.reserveCloudFilename(vaultId, testSourceId, "Notes/", "lecture.pdf", sha256, testJobId, taskId)

        // Pre-populate B2 storage with the existing object
        fakeB2Storage.uploadFileStream(
            cloudObjectPath = b2Key,
            inputStream = ByteArrayInputStream(contentBytes),
            metadata = mapOf(
                "x-amz-meta-sha256" to sha256,
                "x-amz-meta-source-id" to testSourceId,
                "x-amz-meta-original-name" to "lecture.pdf",
                "x-amz-meta-file-id" to fileId.toString()
            )
        )

        // Setup local state as UPLOADED_NOT_INDEXED
        fileRepository.updateFileStatus(fileId, FileStatus.NAME_RESERVED)
        fileRepository.updateFileStatus(fileId, FileStatus.UPLOADING)
        fileRepository.updateFileStatus(fileId, FileStatus.UPLOADED_NOT_INDEXED)

        val task = UploadTask(
            taskId = taskId,
            fileId = fileId,
            state = UploadTaskState.UPLOADED_NOT_INDEXED,
            b2ObjectKey = b2Key,
            uploadSessionUri = null,
            reservationId = resId,
            sha256 = sha256,
            bytesTransferred = contentBytes.size.toLong(),
            totalBytes = contentBytes.size.toLong(),
            updatedAt = System.currentTimeMillis()
        )
        uploadRepository.createTask(task)

        val initialUploadCalls = fakeB2Storage.uploadCallCount // 1
        val initialHeadCalls = fakeB2Storage.headCallCount // 0

        // Process recovery
        val success = recoveryEngine.processOrRecoverUpload(
            vaultId = vaultId,
            file = fileRepository.getFile(fileId)!!,
            task = uploadRepository.getTask(taskId)!!,
            inputStreamProvider = { ByteArrayInputStream(contentBytes) }
        )

        assertTrue(success)

        // Verify HEAD was called on B2 to verify existence, and NO new upload was made
        assertEquals(initialUploadCalls, fakeB2Storage.uploadCallCount)
        assertEquals(initialHeadCalls + 1, fakeB2Storage.headCallCount)

        // Verify state transitioned to INDEXED
        assertEquals(FileStatus.INDEXED, fileRepository.getFile(fileId)?.status)
        assertEquals(UploadTaskState.INDEXED, uploadRepository.getTask(taskId)?.state)
        assertEquals(1, jobRepository.getJob(testJobId)?.uploadedFiles)
    }
}
