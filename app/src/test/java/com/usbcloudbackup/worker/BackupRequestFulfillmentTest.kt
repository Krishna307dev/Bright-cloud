package com.usbcloudbackup.worker

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.SourceRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.storage.b2.FakeB2StorageRepository
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.hashing.Sha256Calculator
import com.usbcloudbackup.storage.DiscoveredFileDescriptor
import com.usbcloudbackup.storage.UsbStorageSource
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
class BackupRequestFulfillmentTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var sourceRepository: SourceRepository
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository

    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeB2Storage: FakeB2StorageRepository

    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val uid = "test_anon_device"
    private val targetSourceId = "target-usb-123"
    private val otherSourceId = "other-usb-456"

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        AppDatabase.setTestInstance(db)

        sourceRepository = SourceRepository(db.sourceDao())
        fileRepository = FileRepository(db.fileDao())
        jobRepository = BackupJobRepository(db.backupJobDao())

        fakeFirestore = FakeFirestoreRepository()
        fakeB2Storage = FakeB2StorageRepository()

        BackupWorker.testFirestoreRepositoryOverride = fakeFirestore
        BackupWorker.testCloudStorageRepositoryOverride = fakeB2Storage
        BackupWorker.testAuthRepositoryOverride = object : AuthRepository {
            override fun getCurrentUid(): String = uid
            override fun isAuthenticated(): Boolean = true
            override suspend fun ensureAuthenticated(): String = uid
            override fun getAuthMethod(): String = "anonymous"
        }
    }

    @After
    fun teardown() {
        BackupWorker.testStorageSourceProvider = null
        BackupWorker.testFirestoreRepositoryOverride = null
        BackupWorker.testCloudStorageRepositoryOverride = null
        BackupWorker.testAuthRepositoryOverride = null
        AppDatabase.setTestInstance(null)
        db.close()
    }

    @Test
    fun testCategoryAAutomaticUploadAndCategoryBMetadataOnlyIndexing() {
        runBlocking {
            val videoContent = "Actual physical video bytes on USB".toByteArray()
            val textContent = "Important notes text content".toByteArray()
            val expectedTextHash = Sha256Calculator.calculateHash(ByteArrayInputStream(textContent))

            // Mock USB attached with Category A and Category B files
            val fakeSource = object : UsbStorageSource {
                override val sourceId: String = targetSourceId
                override val displayName: String = "My Target USB"
                override suspend fun isAvailable(): Boolean = true
                override suspend fun discoverFiles(): List<DiscoveredFileDescriptor> {
                    return listOf(
                        DiscoveredFileDescriptor(
                            relativePath = "Videos/",
                            originalName = "holiday.mp4",
                            size = videoContent.size.toLong(),
                            lastModified = System.currentTimeMillis(),
                            mimeType = "video/mp4",
                            openInputStream = { ByteArrayInputStream(videoContent) }
                        ),
                        DiscoveredFileDescriptor(
                            relativePath = "Documents/",
                            originalName = "notes.txt",
                            size = textContent.size.toLong(),
                            lastModified = System.currentTimeMillis(),
                            mimeType = "text/plain",
                            openInputStream = { ByteArrayInputStream(textContent) }
                        )
                    )
                }
            }
            BackupWorker.testStorageSourceProvider = { fakeSource }

            val worker = TestListenableWorkerBuilder<BackupWorker>(context)
                .setInputData(workDataOf(BackupWorkManager.KEY_SOURCE_ID to targetSourceId))
                .build()

            val result = worker.doWork()
            assertEquals(ListenableWorker.Result.success(), result)

            // Both files (notes.txt and holiday.mp4) MUST be automatically uploaded to B2
            val textUploadedBytes = fakeB2Storage.getStoredBytes("backups/$vaultId/$targetSourceId/Documents/notes.txt")
            assertNotNull("Expected notes.txt to be uploaded to B2", textUploadedBytes)
            assertEquals(textContent.size, textUploadedBytes!!.size)

            val textMeta = fakeB2Storage.getStoredMetadata("backups/$vaultId/$targetSourceId/Documents/notes.txt")
            assertNotNull(textMeta)
            assertEquals(expectedTextHash, textMeta!!["x-amz-meta-sha256"])

            // Under universal automatic byte-upload, holiday.mp4 MUST be uploaded to B2 as well
            val videoUploadedBytes = fakeB2Storage.getStoredBytes("backups/$vaultId/$targetSourceId/Videos/holiday.mp4")
            assertNotNull("Expected holiday.mp4 bytes to be uploaded to B2", videoUploadedBytes)
            assertEquals(videoContent.size, videoUploadedBytes!!.size)

            val jobs = jobRepository.getJobsForSource(targetSourceId)
            assertEquals(1, jobs.size)
            val files = fileRepository.getFilesForJob(jobs[0].jobId)
            val videoFile = files.first { it.originalName == "holiday.mp4" }
            assertEquals(FileStatus.INDEXED, videoFile.status)
            assertEquals("AUTOMATIC", videoFile.backupMode)

            val textFile = files.first { it.originalName == "notes.txt" }
            assertEquals(FileStatus.INDEXED, textFile.status)
            assertEquals("AUTOMATIC", textFile.backupMode)
        }
    }
}
