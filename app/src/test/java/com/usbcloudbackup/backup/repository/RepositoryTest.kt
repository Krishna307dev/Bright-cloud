package com.usbcloudbackup.backup.repository

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.NameReservation
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.backup.model.UploadTask
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.database.AppDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RepositoryTest {

    private lateinit var db: AppDatabase
    private lateinit var sourceRepository: SourceRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var fileRepository: FileRepository
    private lateinit var uploadRepository: UploadRepository
    private lateinit var reservationRepository: ReservationRepository

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        sourceRepository = SourceRepository(db.sourceDao())
        jobRepository = BackupJobRepository(db.backupJobDao())
        fileRepository = FileRepository(db.fileDao())
        uploadRepository = UploadRepository(db.uploadTaskDao())
        reservationRepository = ReservationRepository(db.nameReservationDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun testSourceRepositorySaveAndGet() = runBlocking {
        val source = UsbSource(
            sourceId = "vendor-prod-SN123",
            usbVendorId = 100,
            usbProductId = 200,
            serialNumber = "SN123",
            volumeUuid = "VOL123",
            displayName = "USB Drive",
            firstSeen = 1000L,
            lastSeen = 2000L
        )

        sourceRepository.saveSource(source)
        val retrieved = sourceRepository.getSource("vendor-prod-SN123")

        assertNotNull(retrieved)
        assertEquals("USB Drive", retrieved?.displayName)
    }

    @Test
    fun testBackupJobRepositoryStateTransitions() = runBlocking {
        val source = UsbSource("s1", 1, 2, "SN", "VOL", "USB", 1L, 1L)
        sourceRepository.saveSource(source)

        val job = BackupJob(
            jobId = "j1",
            sourceId = "s1",
            state = BackupJobState.SCANNING,
            startedAt = 100L
        )
        jobRepository.createJob(job)

        // Valid transition SCANNING -> HASHING
        jobRepository.updateJobState("j1", BackupJobState.HASHING)
        var updated = jobRepository.getJob("j1")
        assertEquals(BackupJobState.HASHING, updated?.state)

        // Valid transition HASHING -> DEDUPLICATING
        jobRepository.updateJobState("j1", BackupJobState.DEDUPLICATING)
        updated = jobRepository.getJob("j1")
        assertEquals(BackupJobState.DEDUPLICATING, updated?.state)
    }

    @Test(expected = IllegalStateException::class)
    fun testBackupJobRepositoryIllegalStateTransitionThrows() = runBlocking {
        val source = UsbSource("s1", 1, 2, "SN", "VOL", "USB", 1L, 1L)
        sourceRepository.saveSource(source)
        val job = BackupJob("j1", "s1", BackupJobState.SCANNING, 100L)
        jobRepository.createJob(job)

        // Invalid transition SCANNING -> COMPLETED
        jobRepository.updateJobState("j1", BackupJobState.COMPLETED)
    }

    @Test
    fun testFileRepositoryHashDeduplicationLookup() = runBlocking {
        val source = UsbSource("s1", 1, 2, "SN", "VOL", "USB", 1L, 1L)
        sourceRepository.saveSource(source)
        val job = BackupJob("j1", "s1", BackupJobState.HASHING, 100L)
        jobRepository.createJob(job)

        val file = BackupFile(
            jobId = "j1",
            sourceId = "s1",
            relativePath = "docs/",
            originalName = "report.pdf",
            sha256 = "abc123hash",
            size = 2048L,
            lastModified = 500L,
            status = FileStatus.HASHED
        )
        val fileId = fileRepository.addDiscoveredFile(file)

        val found = fileRepository.findExistingFileByHash("abc123hash")
        assertNotNull(found)
        assertEquals("report.pdf", found?.originalName)
        assertEquals(fileId, found?.id)
    }

    @Test
    fun testUploadRepositorySessionUriPersistence() = runBlocking {
        val source = UsbSource("s1", 1, 2, "SN", "VOL", "USB", 1L, 1L)
        sourceRepository.saveSource(source)
        val job = BackupJob("j1", "s1", BackupJobState.UPLOADING, 100L)
        jobRepository.createJob(job)
        val file = BackupFile(jobId = "j1", sourceId = "s1", relativePath = "", originalName = "img.png", size = 500L, lastModified = 1L, status = FileStatus.UPLOADING)
        val fileId = fileRepository.addDiscoveredFile(file)

        val task = UploadTask(
            taskId = "task-abc",
            fileId = fileId,
            state = UploadTaskState.UPLOADING,
            b2ObjectKey = "backups/default/s1/img.png",
            uploadSessionUri = "https://firebasestorage.googleapis.com/session/12345",
            reservationId = "res-123",
            sha256 = "hash123",
            bytesTransferred = 100L,
            totalBytes = 500L,
            updatedAt = 1000L
        )
        uploadRepository.createTask(task)

        val fetched = uploadRepository.getTask("task-abc")
        assertEquals("https://firebasestorage.googleapis.com/session/12345", fetched?.uploadSessionUri)

        uploadRepository.updateProgress("task-abc", 300L, 500L)
        val updatedProgress = uploadRepository.getTask("task-abc")
        assertEquals(300L, updatedProgress?.bytesTransferred)
    }

    @Test
    fun testReservationRepositoryExpiryCleanup() = runBlocking {
        val now = System.currentTimeMillis()
        val expiredRes = NameReservation(
            reservationId = "res-exp",
            sha256 = "h1",
            b2ObjectKey = "p1",
            sourceId = "s1",
            relativePath = "",
            originalName = "a.txt",
            storedName = "a.txt",
            version = 0,
            status = ReservationStatus.PENDING,
            jobId = "j1",
            ownerTaskId = "t1",
            createdAt = now - 100000L,
            expiresAt = now - 1000L
        )
        val validRes = NameReservation(
            reservationId = "res-val",
            sha256 = "h2",
            b2ObjectKey = "p2",
            sourceId = "s1",
            relativePath = "",
            originalName = "b.txt",
            storedName = "b.txt",
            version = 0,
            status = ReservationStatus.PENDING,
            jobId = "j1",
            ownerTaskId = "t2",
            createdAt = now,
            expiresAt = now + 86400000L
        )

        reservationRepository.saveReservation(expiredRes)
        reservationRepository.saveReservation(validRes)

        val deleted = reservationRepository.deleteExpiredReservations(now)
        assertEquals(1, deleted)

        assertNull(reservationRepository.getReservation("res-exp"))
        assertNotNull(reservationRepository.getReservation("res-val"))
    }
}
