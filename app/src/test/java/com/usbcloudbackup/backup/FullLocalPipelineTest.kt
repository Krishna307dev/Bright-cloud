package com.usbcloudbackup.backup

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.UploadRepository
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
class FullLocalPipelineTest {

    private lateinit var db: AppDatabase
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var reservationRepository: ReservationRepository
    private lateinit var uploadRepository: UploadRepository
    private lateinit var scanner: FileScanner
    private lateinit var deduplicationEngine: DeduplicationEngine
    private lateinit var nameResolver: VersionedNameResolver

    private val uid = "test_user_999"
    private val sourceId = "usb-full-test"
    private val jobId = "job-full-001"

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        fileRepository = FileRepository(db.fileDao())
        jobRepository = BackupJobRepository(db.backupJobDao())
        reservationRepository = ReservationRepository(db.nameReservationDao())
        uploadRepository = UploadRepository(db.uploadTaskDao())

        scanner = FileScanner(fileRepository, jobRepository)
        deduplicationEngine = DeduplicationEngine(fileRepository, jobRepository)
        nameResolver = VersionedNameResolver(db, fileRepository, reservationRepository, uploadRepository)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun testFullLocalPipelineWithVersioningAndDeduplication() {
        runBlocking {
            // Setup source and job
            val source = UsbSource(sourceId, 1111, 2222, "SN_FULL", "VOL_FULL", "Full Pipeline USB", 1000L, 2000L)
            db.sourceDao().insertSource(source.toEntity())
            val job = BackupJob(jobId, sourceId, BackupJobState.SCANNING, System.currentTimeMillis())
            jobRepository.createJob(job)

            // Prepare Fake USB drive with 4 files:
            // File 1: Notes/Math/Chapter1.pdf (Content AAA)
            // File 2: Backup/Notes/Chapter1_dup.pdf (Content AAA - duplicate of File 1, must be SKIPPED)
            // File 3: Notes/Math/Chapter1_new.pdf (Content BBB - different content in same path)
            // File 4: Notes/Science/Physics.docx (Content CCC - unique content & distinct path)
            val contentAAA = "Content AAA".toByteArray(Charsets.UTF_8)
            val contentBBB = "Content BBB (Modified)".toByteArray(Charsets.UTF_8)
            val contentCCC = "Physics notes content".toByteArray(Charsets.UTF_8)

            val fakeSource = FakeStorageSource(sourceId, "Full Pipeline USB")
            fakeSource.addFile("Notes/Math/", "Chapter1.pdf", contentAAA)
            fakeSource.addFile("Backup/Notes/", "Chapter1_dup.pdf", contentAAA) // Duplicate of AAA
            fakeSource.addFile("Notes/Math/", "Chapter1_new.pdf", contentBBB)
            fakeSource.addFile("Notes/Science/", "Physics.docx", contentCCC)

            // Step 1: File Discovery
            val discoveredFiles = scanner.scanSource(jobId, fakeSource)
            assertEquals(4, discoveredFiles.size)
            jobRepository.updateJobState(jobId, BackupJobState.HASHING)

            val descriptorsMap = fakeSource.discoverFiles().associateBy { "${it.relativePath}${it.originalName}" }

            // Step 2: Hashing
            for (file in discoveredFiles) {
                val key = "${file.relativePath}${file.originalName}"
                val descriptor = descriptorsMap[key]
                assertNotNull(descriptor)

                fileRepository.updateFileStatus(file.id, FileStatus.HASHING)
                val hash = Sha256Calculator.calculateHash(descriptor!!.openInputStream())
                fileRepository.updateFileHash(file.id, hash, FileStatus.HASHED)
            }

            jobRepository.updateJobState(jobId, BackupJobState.DEDUPLICATING)

            // Step 3: Local Deduplication & Filename Versioning Reservation
            val hashedFiles = fileRepository.getFilesForJob(jobId)

            for (file in hashedFiles) {
                val dedupResult = deduplicationEngine.checkLocalDeduplication(file)
                if (dedupResult is DeduplicationResult.NewContent) {
                    val taskOwnerId = "task-worker-${file.id}"
                    val reservationResult = nameResolver.reserveFilename(uid, file, taskOwnerId)

                    assertNotNull(reservationResult.storedName)
                    assertNotNull(reservationResult.b2ObjectKey)

                    // Simulate completed upload lifecycle in real pipeline
                    fileRepository.updateFileStatus(file.id, FileStatus.UPLOADING)
                    fileRepository.updateFileStatus(file.id, FileStatus.UPLOADED_NOT_INDEXED)
                    fileRepository.updateFileStatus(file.id, FileStatus.INDEXED)
                }
            }

            // Step 4: Verify Final Database States
            val finalFiles = fileRepository.getFilesForJob(jobId)
            assertEquals(4, finalFiles.size)

            val skippedFiles = finalFiles.filter { it.status == FileStatus.SKIPPED_DUPLICATE }
            val indexedFiles = finalFiles.filter { it.status == FileStatus.INDEXED }

            assertEquals(1, skippedFiles.size)
            assertEquals(3, indexedFiles.size)

            // Verify duplicate file state
            val dupFile = skippedFiles.first()
            assertEquals("Chapter1_dup.pdf", dupFile.originalName)

            // Verify versioned file storedNames
            val mathFiles = indexedFiles.filter { it.relativePath == "Notes/Math/" }
            assertEquals(2, mathFiles.size)

            val mathFileNames = mathFiles.map { it.cloudFilename }.toSet()
            assertTrue(mathFileNames.contains("Chapter1.pdf"))
            assertTrue(mathFileNames.contains("Chapter1_new.pdf"))

            // Verify Room NameReservationEntity table
            val reservations = db.nameReservationDao().getReservationsByJob(jobId)
            assertEquals(3, reservations.size)
            for (res in reservations) {
                assertEquals(ReservationStatus.PENDING, res.status)
                assertTrue(res.expiresAt > System.currentTimeMillis())
            }

            // Verify Room UploadTaskEntity table
            val unfinishedTasks = uploadRepository.getUnfinishedTasks()
            assertEquals(3, unfinishedTasks.size)
            for (task in unfinishedTasks) {
                assertEquals(UploadTaskState.RESERVED, task.state)
            }
        }
    }
}
