package com.usbcloudbackup.database

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.database.entity.BackupJobEntity
import com.usbcloudbackup.database.entity.FileEntity
import com.usbcloudbackup.database.entity.NameReservationEntity
import com.usbcloudbackup.database.entity.SourceEntity
import com.usbcloudbackup.database.entity.UploadTaskEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RoomDatabaseTest {

    private lateinit var db: AppDatabase

    @Before
    fun createDb() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun closeDb() {
        db.close()
    }

    @Test
    fun testSourceDaoCRUD() = runBlocking {
        val source = SourceEntity(
            sourceId = "1234-5678-SN001",
            usbVendorId = 1234,
            usbProductId = 5678,
            serialNumber = "SN001",
            volumeUuid = "XXXX-YYYY",
            displayName = "USB Drive 1",
            firstSeen = 1000L,
            lastSeen = 2000L
        )

        db.sourceDao().insertSource(source)

        val retrieved = db.sourceDao().getSourceById("1234-5678-SN001")
        assertNotNull(retrieved)
        assertEquals("USB Drive 1", retrieved?.displayName)

        val allSources = db.sourceDao().getAllSources()
        assertEquals(1, allSources.size)
    }

    @Test
    fun testBackupJobDaoAndCounters() = runBlocking {
        val source = SourceEntity(
            sourceId = "1234-5678-SN001",
            usbVendorId = 1234,
            usbProductId = 5678,
            serialNumber = "SN001",
            volumeUuid = null,
            displayName = "USB Drive",
            firstSeen = 1000L,
            lastSeen = 1000L
        )
        db.sourceDao().insertSource(source)

        val job = BackupJobEntity(
            jobId = "job-001",
            sourceId = "1234-5678-SN001",
            state = BackupJobState.SCANNING,
            startedAt = 1000L,
            totalFiles = 10
        )
        db.backupJobDao().insertJob(job)

        db.backupJobDao().updateJobState("job-001", BackupJobState.HASHING)
        var fetched = db.backupJobDao().getJobById("job-001")
        assertEquals(BackupJobState.HASHING, fetched?.state)

        db.backupJobDao().incrementUploadedCount("job-001")
        db.backupJobDao().incrementSkippedCount("job-001")
        db.backupJobDao().incrementErrorCount("job-001")

        fetched = db.backupJobDao().getJobById("job-001")
        assertEquals(1, fetched?.uploadedFiles)
        assertEquals(1, fetched?.skippedFiles)
        assertEquals(1, fetched?.errorFiles)

        val incomplete = db.backupJobDao().getIncompleteJobsForSource("1234-5678-SN001")
        assertEquals(1, incomplete.size)

        db.backupJobDao().updateJobState("job-001", BackupJobState.COMPLETED, 2000L)
        val incompleteAfter = db.backupJobDao().getIncompleteJobsForSource("1234-5678-SN001")
        assertEquals(0, incompleteAfter.size)
    }

    @Test
    fun testFileDaoAndSha256Lookup() = runBlocking {
        val source = SourceEntity("src1", 1, 2, "SN", null, "USB", 1L, 1L)
        db.sourceDao().insertSource(source)
        val job = BackupJobEntity("job1", "src1", BackupJobState.UPLOADING, 1L)
        db.backupJobDao().insertJob(job)

        val file = FileEntity(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "Notes/",
            originalName = "CHAPTER_5.pdf",
            sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            size = 1024L,
            lastModified = 500L,
            status = FileStatus.DISCOVERED
        )
        val fileId = db.fileDao().insertFile(file)
        assertTrue(fileId > 0)

        // Lookup by SHA-256 (Local deduplication check)
        val foundByHash = db.fileDao().findFileBySha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        assertNotNull(foundByHash)
        assertEquals("CHAPTER_5.pdf", foundByHash?.originalName)

        // Lookup by path
        val foundByPath = db.fileDao().findExistingFileByPath("src1", "Notes/", "CHAPTER_5.pdf")
        assertNotNull(foundByPath)

        // Update status and cloud info
        db.fileDao().updateFileCloudInfo(
            fileId,
            cloudFilename = "CHAPTER_5(1).pdf",
            b2ObjectKey = "backups/default/src1/Notes/CHAPTER_5(1).pdf",
            status = FileStatus.UPLOADING
        )

        val updated = db.fileDao().getFileById(fileId)
        assertEquals("CHAPTER_5(1).pdf", updated?.cloudFilename)
        assertEquals(FileStatus.UPLOADING, updated?.status)

        val interrupted = db.fileDao().getInterruptedFiles()
        assertEquals(1, interrupted.size)
    }

    @Test
    fun testUploadTaskDaoAndSessionUri() = runBlocking {
        val source = SourceEntity("src1", 1, 2, "SN", null, "USB", 1L, 1L)
        db.sourceDao().insertSource(source)
        val job = BackupJobEntity("job1", "src1", BackupJobState.UPLOADING, 1L)
        db.backupJobDao().insertJob(job)
        val file = FileEntity(
            jobId = "job1",
            sourceId = "src1",
            relativePath = "",
            originalName = "test.txt",
            size = 100L,
            lastModified = 1L,
            status = FileStatus.UPLOADING
        )
        val fileId = db.fileDao().insertFile(file)

        val task = UploadTaskEntity(
            taskId = "task-001",
            fileId = fileId,
            state = UploadTaskState.UPLOADING,
            b2ObjectKey = "backups/default/src1/test.txt",
            uploadSessionUri = "https://firebasestorage.googleapis.com/upload/session/123",
            reservationId = "res-001",
            sha256 = "dummyhash",
            bytesTransferred = 50L,
            totalBytes = 100L,
            updatedAt = System.currentTimeMillis()
        )
        db.uploadTaskDao().insertTask(task)

        val fetched = db.uploadTaskDao().getTaskById("task-001")
        assertNotNull(fetched)
        assertEquals("https://firebasestorage.googleapis.com/upload/session/123", fetched?.uploadSessionUri)

        val unfinished = db.uploadTaskDao().getUnfinishedTasks()
        assertEquals(1, unfinished.size)
    }

    @Test
    fun testNameReservationDaoAndExpiry() = runBlocking {
        val now = System.currentTimeMillis()
        val reservation1 = NameReservationEntity(
            reservationId = "res-001",
            sha256 = "hash1",
            b2ObjectKey = "path1",
            sourceId = "src1",
            relativePath = "",
            originalName = "file.txt",
            storedName = "file.txt",
            version = 0,
            status = ReservationStatus.PENDING,
            jobId = "job1",
            ownerTaskId = "task1",
            createdAt = now - 100000L,
            expiresAt = now - 1000L // Expired
        )
        val reservation2 = NameReservationEntity(
            reservationId = "res-002",
            sha256 = "hash2",
            b2ObjectKey = "path2",
            sourceId = "src1",
            relativePath = "",
            originalName = "file2.txt",
            storedName = "file2.txt",
            version = 0,
            status = ReservationStatus.PENDING,
            jobId = "job1",
            ownerTaskId = "task2",
            createdAt = now,
            expiresAt = now + 86400000L // Active
        )

        db.nameReservationDao().insertReservation(reservation1)
        db.nameReservationDao().insertReservation(reservation2)

        val expired = db.nameReservationDao().getPendingExpiredReservations(now)
        assertEquals(1, expired.size)
        assertEquals("res-001", expired[0].reservationId)

        val deletedCount = db.nameReservationDao().deleteExpiredReservations(now)
        assertEquals(1, deletedCount)

        assertNull(db.nameReservationDao().getReservationById("res-001"))
        assertNotNull(db.nameReservationDao().getReservationById("res-002"))
    }
}
