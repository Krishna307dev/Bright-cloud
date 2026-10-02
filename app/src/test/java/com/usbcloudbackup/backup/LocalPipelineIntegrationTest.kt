package com.usbcloudbackup.backup

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.hashing.Sha256Calculator
import com.usbcloudbackup.scanning.FileScanner
import com.usbcloudbackup.storage.FakeStorageSource
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
class LocalPipelineIntegrationTest {

    private lateinit var db: AppDatabase
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var scanner: FileScanner
    private lateinit var deduplicationEngine: DeduplicationEngine

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        fileRepository = FileRepository(db.fileDao())
        jobRepository = BackupJobRepository(db.backupJobDao())
        scanner = FileScanner(fileRepository, jobRepository)
        deduplicationEngine = DeduplicationEngine(fileRepository, jobRepository)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun testEndToEndLocalPipelineDiscoveryHashingDeduplication() = runBlocking {
        val sourceId = "test-usb-999"
        val jobId = "job-e2e-001"

        val source = UsbSource(sourceId, 1234, 5678, "SN999", "VOL999", "E2E USB Drive", 1000L, 2000L)
        db.sourceDao().insertSource(source.toEntity())
        val job = BackupJob(jobId, sourceId, BackupJobState.SCANNING, System.currentTimeMillis())
        jobRepository.createJob(job)

        // Setup Fake USB Source with 3 files:
        // File 1: Unique content
        // File 2: Same content as File 1 (duplicate)
        // File 3: Unique content
        val content1 = "Unique content number one".toByteArray(Charsets.UTF_8)
        val content2 = "Unique content number one".toByteArray(Charsets.UTF_8) // Duplicate of content1
        val content3 = "Unique content number three".toByteArray(Charsets.UTF_8)

        val fakeSource = FakeStorageSource(sourceId, "E2E USB Drive")
        fakeSource.addFile("Docs/", "Doc1.txt", content1)
        fakeSource.addFile("Backup/Docs/", "Doc1_copy.txt", content2)
        fakeSource.addFile("Notes/", "Hindi_नोट्स.txt", content3)

        // Step 1: Scan
        val discoveredFiles = scanner.scanSource(jobId, fakeSource)
        assertEquals(3, discoveredFiles.size)
        jobRepository.updateJobState(jobId, BackupJobState.HASHING)

        val descriptorsMap = fakeSource.discoverFiles().associateBy { "${it.relativePath}${it.originalName}" }

        // Step 2: Streaming Hash
        for (file in discoveredFiles) {
            val key = "${file.relativePath}${file.originalName}"
            val descriptor = descriptorsMap[key]
            assertNotNull(descriptor)

            // Validate state transition: DISCOVERED -> HASHING -> HASHED
            fileRepository.updateFileStatus(file.id, FileStatus.HASHING)
            val hash = Sha256Calculator.calculateHash(descriptor!!.openInputStream())
            fileRepository.updateFileHash(file.id, hash, FileStatus.HASHED)
        }

        jobRepository.updateJobState(jobId, BackupJobState.DEDUPLICATING)

        // Step 3: Deduplication
        val hashedFiles = fileRepository.getFilesForJob(jobId)
        val readyForUpload = mutableListOf<Long>()

        for (file in hashedFiles) {
            val dedupResult = deduplicationEngine.checkLocalDeduplication(file)
            if (dedupResult is DeduplicationResult.NewContent) {
                // Validate state transition to INDEXED for real-world deduplication qualification
                fileRepository.updateFileStatus(file.id, FileStatus.NAME_RESERVING)
                fileRepository.updateFileStatus(file.id, FileStatus.NAME_RESERVED)
                fileRepository.updateFileStatus(file.id, FileStatus.UPLOADING)
                fileRepository.updateFileStatus(file.id, FileStatus.UPLOADED_NOT_INDEXED)
                fileRepository.updateFileStatus(file.id, FileStatus.INDEXED)
                readyForUpload.add(file.id)
            } else if (dedupResult is DeduplicationResult.SkippedDuplicate) {
                // DeduplicationEngine automatically updates state to SKIPPED_DUPLICATE
            }
        }

        // Step 4: Verify Room DB final state
        val finalFiles = fileRepository.getFilesForJob(jobId)
        assertEquals(3, finalFiles.size)

        val skippedCount = finalFiles.count { it.status == FileStatus.SKIPPED_DUPLICATE }
        val indexedCount = finalFiles.count { it.status == FileStatus.INDEXED }

        assertEquals(1, skippedCount)
        assertEquals(2, indexedCount)

        val updatedJob = jobRepository.getJob(jobId)
        assertEquals(3, updatedJob?.totalFiles)
        assertEquals(1, updatedJob?.skippedFiles)

        val copyFile = finalFiles.find { it.originalName == "Doc1_copy.txt" }
        assertNotNull(copyFile)
        assertEquals(FileStatus.SKIPPED_DUPLICATE, copyFile?.status)
    }
}
