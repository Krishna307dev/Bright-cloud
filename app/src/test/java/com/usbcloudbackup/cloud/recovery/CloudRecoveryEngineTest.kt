package com.usbcloudbackup.cloud.recovery

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.ReservedNameResult
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
class CloudRecoveryEngineTest {

    private lateinit var db: AppDatabase
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var uploadRepository: UploadRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var recoveryEngine: CloudRecoveryEngine

    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val testSourceId = "src-crash-usb"
    private val testJobId = "job-crash-001"

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
        fakeStorage = FakeCloudStorageRepository()

        recoveryEngine = CloudRecoveryEngine(
            fileRepository,
            jobRepository,
            uploadRepository,
            fakeFirestore,
            fakeStorage
        )

        runBlocking {
            val source = UsbSource(testSourceId, 111, 222, "SN_CRASH", "VOL_CRASH", "Crash Test USB", 1000L, 2000L)
            db.sourceDao().insertSource(source.toEntity())
            val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
            jobRepository.createJob(job)
        }
    }

    @After
    fun tearDown() {
        db.close()
        fakeFirestore.clear()
        fakeStorage.clear()
    }

    @Test
    fun testCloudDeduplicationSkipsUploadAndReservation() {
        runBlocking {
            val sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

            // Simulate file already indexed in Cloud Firestore
            fakeFirestore.contentHashes["${vaultId}_$sha256"] = mapOf("sha256" to sha256)

            val file = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Notes/",
                originalName = "Doc.pdf",
                sha256 = sha256,
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val fileId = fileRepository.addDiscoveredFile(file)
            val fileWithId = fileRepository.getFile(fileId)!!

            val isDuplicate = recoveryEngine.checkCloudDeduplication(vaultId, fileWithId)
            assertTrue(isDuplicate)

            val updatedFile = fileRepository.getFile(fileId)
            assertEquals(FileStatus.SKIPPED_DUPLICATE, updatedFile?.status)

            val updatedJob = jobRepository.getJob(testJobId)
            assertEquals(1, updatedJob?.skippedFiles)
        }
    }

    @Test
    fun testScenario4RecoveryStorageSucceededFirestoreFailed() {
        runBlocking {
            val sha256 = "1111111111111111111111111111111111111111111111111111111111111111"
            val contentBytes = "Crash recovery test content".toByteArray(Charsets.UTF_8)

            val file = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Docs/",
                originalName = "Important.pdf",
                sha256 = sha256,
                size = contentBytes.size.toLong(),
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val fileId = fileRepository.addDiscoveredFile(file)
            val fileWithId = fileRepository.getFile(fileId)!!

            val taskId = "task-crash-recov-001"
            val resId = "res-crash-001"
            val b2Key = "backups/$vaultId/$testSourceId/Docs/Important.pdf"

            // Pre-reserve filename in Firestore
            fakeFirestore.reserveCloudFilename(vaultId, testSourceId, "Docs/", "Important.pdf", sha256, testJobId, taskId)

            // Simulate pre-existing upload in Cloud Storage (e.g. upload succeeded before process crash)
            fakeStorage.uploadFileStream(
                cloudObjectPath = b2Key,
                inputStream = ByteArrayInputStream(contentBytes),
                metadata = mapOf(
                    "x-custom-sha256" to sha256,
                    "x-custom-source-id" to testSourceId,
                    "x-custom-original-name" to "Important.pdf",
                    "x-custom-file-id" to fileId.toString()
                )
            )

            // Step through valid transitions to set up state = UPLOADED_NOT_INDEXED
            fileRepository.updateFileStatus(fileId, FileStatus.NAME_RESERVED)
            fileRepository.updateFileStatus(fileId, FileStatus.UPLOADING)
            fileRepository.updateFileStatus(fileId, FileStatus.UPLOADED_NOT_INDEXED)

            val task = UploadTask(
                taskId = taskId,
                fileId = fileId,
                state = UploadTaskState.UPLOADED_NOT_INDEXED,
                b2ObjectKey = b2Key,
                uploadSessionUri = "https://fake.storage.session/123",
                reservationId = resId,
                sha256 = sha256,
                bytesTransferred = contentBytes.size.toLong(),
                totalBytes = contentBytes.size.toLong(),
                updatedAt = System.currentTimeMillis()
            )
            uploadRepository.createTask(task)

            val uploadsBeforeRecovery = fakeStorage.uploadCount

            // Execute recovery
            val success = recoveryEngine.processOrRecoverUpload(
                vaultId = vaultId,
                file = fileRepository.getFile(fileId)!!,
                task = uploadRepository.getTask(taskId)!!,
                inputStreamProvider = { ByteArrayInputStream(contentBytes) }
            )

            assertTrue(success)

            // Verify byte re-upload did NOT occur
            assertEquals(uploadsBeforeRecovery, fakeStorage.uploadCount)

            // Verify Firestore finalization occurred
            assertEquals(1, fakeFirestore.finalizeTransactionCount)
            assertTrue(fakeFirestore.contentHashes.containsKey("${vaultId}_$sha256"))

            // Verify Room state updated to INDEXED
            val finalFile = fileRepository.getFile(fileId)
            assertEquals(FileStatus.INDEXED, finalFile?.status)

            val finalTask = uploadRepository.getTask(taskId)
            assertEquals(UploadTaskState.INDEXED, finalTask?.state)
        }
    }
}
