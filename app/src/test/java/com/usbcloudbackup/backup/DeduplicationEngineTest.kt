package com.usbcloudbackup.backup

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.database.AppDatabase
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
class DeduplicationEngineTest {

    private lateinit var db: AppDatabase
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var engine: DeduplicationEngine

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        fileRepository = FileRepository(db.fileDao())
        jobRepository = BackupJobRepository(db.backupJobDao())
        engine = DeduplicationEngine(fileRepository, jobRepository)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun testIdenticalContentDifferentFilenamesDeduplication() = runBlocking {
        val source = UsbSource("src1", 1, 2, "SN", null, "USB", 1L, 1L)
        db.sourceDao().insertSource(source.toEntity())
        val job = BackupJob("job1", "src1", BackupJobState.UPLOADING, 100L)
        jobRepository.createJob(job)

        val hashA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

        // First file already uploaded/indexed in Room
        val existingFile = BackupFile(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "docs/",
            originalName = "fileA.pdf",
            sha256 = hashA,
            size = 100L,
            lastModified = 1000L,
            status = FileStatus.INDEXED
        )
        val file1Id = fileRepository.addDiscoveredFile(existingFile)

        // Second file discovered with identical content hash but different filename
        val newFile = BackupFile(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "photos/",
            originalName = "fileB.pdf",
            sha256 = hashA,
            size = 100L,
            lastModified = 2000L,
            status = FileStatus.HASHED
        )
        val file2Id = fileRepository.addDiscoveredFile(newFile)

        val file2WithId = fileRepository.getFile(file2Id)!!
        val result = engine.checkLocalDeduplication(file2WithId)

        assertTrue(result is DeduplicationResult.SkippedDuplicate)
        val skippedResult = result as DeduplicationResult.SkippedDuplicate
        assertEquals(file1Id, skippedResult.existingFileId)
        assertEquals(hashA, skippedResult.sha256)

        val updatedFile2 = fileRepository.getFile(file2Id)
        assertEquals(FileStatus.SKIPPED_DUPLICATE, updatedFile2?.status)

        val updatedJob = jobRepository.getJob("job1")
        assertEquals(1, updatedJob?.skippedFiles)
    }

    @Test
    fun testSameFilenameDifferentContentIsNewContent() = runBlocking {
        val source = UsbSource("src1", 1, 2, "SN", null, "USB", 1L, 1L)
        db.sourceDao().insertSource(source.toEntity())
        val job = BackupJob("job1", "src1", BackupJobState.UPLOADING, 100L)
        jobRepository.createJob(job)

        val hashAAA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val hashBBB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

        // First version stored
        val existingFile = BackupFile(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "Notes/",
            originalName = "CHAPTER_5.pdf",
            sha256 = hashAAA,
            size = 100L,
            lastModified = 1000L,
            status = FileStatus.INDEXED
        )
        fileRepository.addDiscoveredFile(existingFile)

        // New file with same filename CHAPTER_5.pdf but changed content (hash BBB)
        val newVersionFile = BackupFile(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "Notes/",
            originalName = "CHAPTER_5.pdf",
            sha256 = hashBBB,
            size = 120L,
            lastModified = 2000L,
            status = FileStatus.HASHED
        )
        val newFileId = fileRepository.addDiscoveredFile(newVersionFile)

        val newFileWithId = fileRepository.getFile(newFileId)!!
        val result = engine.checkLocalDeduplication(newFileWithId)

        assertTrue(result is DeduplicationResult.NewContent)
        val newResult = result as DeduplicationResult.NewContent
        assertEquals(hashBBB, newResult.sha256)

        val updatedJob = jobRepository.getJob("job1")
        assertEquals(0, updatedJob?.skippedFiles)
    }

    @Test
    fun testInFlightStatusesDoNotQualifyForDeduplication() = runBlocking {
        val source = UsbSource("src1", 1, 2, "SN", null, "USB", 1L, 1L)
        db.sourceDao().insertSource(source.toEntity())
        val job = BackupJob("job1", "src1", BackupJobState.UPLOADING, 100L)
        jobRepository.createJob(job)

        val hashShared = "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"

        // In-flight file (NAME_RESERVED or UPLOADING)
        val inFlightFile = BackupFile(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "docs/",
            originalName = "in_flight.pdf",
            sha256 = hashShared,
            size = 100L,
            lastModified = 1000L,
            status = FileStatus.NAME_RESERVED
        )
        fileRepository.addDiscoveredFile(inFlightFile)

        // Second file with identical hash
        val secondFile = BackupFile(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "backup/",
            originalName = "second.pdf",
            sha256 = hashShared,
            size = 100L,
            lastModified = 2000L,
            status = FileStatus.HASHED
        )
        val secondFileId = fileRepository.addDiscoveredFile(secondFile)
        val secondFileWithId = fileRepository.getFile(secondFileId)!!

        val result1 = engine.checkLocalDeduplication(secondFileWithId)
        // Must NOT skip when existing file is only NAME_RESERVED
        assertTrue("NAME_RESERVED must not qualify as duplicate source", result1 is DeduplicationResult.NewContent)

        // Now test with UPLOADED_NOT_INDEXED - this MUST qualify
        val uploadedNotIndexedFile = BackupFile(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "docs/",
            originalName = "uploaded_not_indexed.pdf",
            sha256 = "9999222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
            size = 100L,
            lastModified = 1000L,
            status = FileStatus.UPLOADED_NOT_INDEXED
        )
        val uniFileId = fileRepository.addDiscoveredFile(uploadedNotIndexedFile)

        val candidateFile = BackupFile(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "backup/",
            originalName = "candidate.pdf",
            sha256 = "9999222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
            size = 100L,
            lastModified = 2000L,
            status = FileStatus.HASHED
        )
        val candId = fileRepository.addDiscoveredFile(candidateFile)
        val result2 = engine.checkLocalDeduplication(fileRepository.getFile(candId)!!)
        assertTrue("UPLOADED_NOT_INDEXED must qualify as duplicate source", result2 is DeduplicationResult.SkippedDuplicate)
    }
}
