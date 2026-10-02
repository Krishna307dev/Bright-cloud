package com.usbcloudbackup.resilience

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.VersionedNameResolver
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.NameReservation
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.SourceRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.util.ReservationUtils
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReservationResilienceTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var sourceRepo: SourceRepository
    private lateinit var jobRepo: BackupJobRepository
    private lateinit var fileRepo: FileRepository
    private lateinit var reservationRepo: ReservationRepository
    private lateinit var uploadRepo: UploadRepository
    private lateinit var resolver: VersionedNameResolver

    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val testSourceId = "usb-res-001"
    private val testJobId = "job-res-001"

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

        resolver = VersionedNameResolver(db, fileRepo, reservationRepo, uploadRepo)

        runBlocking {
            val source = UsbSource(testSourceId, 1, 2, "SN_RES", "VOL_RES", "Res Drive", 1000L, 2000L)
            sourceRepo.saveSource(source)
            val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
            jobRepo.createJob(job)
        }
    }

    @After
    fun tearDown() {
        AppDatabase.setTestInstance(null)
        db.close()
    }

    @Test
    fun testReusesExistingValidPendingReservationOnRetry() = runBlocking {
        val sha256 = "3333333333333333333333333333333333333333333333333333333333333333"
        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Notes/",
            originalName = "Chapter1.pdf",
            sha256 = sha256,
            size = 400L,
            lastModified = 1000L,
            status = FileStatus.HASHED
        )
        val fileId = fileRepo.addDiscoveredFile(file)
        val fileWithId = fileRepo.getFile(fileId)!!

        val ownerTaskId = "task-res-reuse"
        val now = System.currentTimeMillis()

        // First reservation attempt
        val res1 = resolver.reserveFilename(vaultId, fileWithId, ownerTaskId, currentTime = now)
        assertEquals("Chapter1.pdf", res1.storedName)
        assertEquals(0, res1.version)
        assertFalse(res1.isReused)

        // Second reservation attempt on same un-expired file (simulating retry)
        val fileReserved = fileRepo.getFile(fileId)!!
        val res2 = resolver.reserveFilename(vaultId, fileReserved, ownerTaskId, currentTime = now + 1000L)

        assertEquals("Chapter1.pdf", res2.storedName)
        assertEquals(0, res2.version)
        assertTrue(res2.isReused)
        assertEquals(res1.reservationId, res2.reservationId)
    }

    @Test
    fun testExpiredPendingReservationIsReclaimed() = runBlocking {
        val sha256 = "4444444444444444444444444444444444444444444444444444444444444444"
        val storedName = "ExpiredDoc.pdf"
        val resId = ReservationUtils.encodeReservationId(testSourceId, "Docs/", storedName)
        val b2Key = ReservationUtils.buildB2ObjectKey(vaultId, testSourceId, "Docs/", storedName)

        val pastTime = 1000L
        val expiredTime = pastTime + (24 * 60 * 60 * 1000L) // expired 24h later

        // Pre-stage an expired reservation in Room
        val expiredRes = NameReservation(
            reservationId = resId,
            sha256 = "old_hash",
            b2ObjectKey = b2Key,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "ExpiredDoc.pdf",
            storedName = storedName,
            version = 0,
            status = ReservationStatus.PENDING,
            jobId = testJobId,
            ownerTaskId = "old_task",
            createdAt = pastTime,
            expiresAt = expiredTime
        )
        reservationRepo.saveReservation(expiredRes)

        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "ExpiredDoc.pdf",
            sha256 = sha256,
            size = 200L,
            lastModified = 5000L,
            status = FileStatus.HASHED
        )
        val fileId = fileRepo.addDiscoveredFile(file)
        val fileWithId = fileRepo.getFile(fileId)!!

        val currentTime = expiredTime + 1000L // 1 second past expiry

        val result = resolver.reserveFilename(vaultId, fileWithId, "task-new", currentTime = currentTime)

        // Expired reservation is reclaimed at version 0
        assertEquals("ExpiredDoc.pdf", result.storedName)
        assertEquals(0, result.version)
        assertFalse(result.isReused)

        val updatedRes = reservationRepo.getReservation(resId)
        assertEquals(ReservationStatus.PENDING, updatedRes?.status)
        assertEquals(sha256, updatedRes?.sha256)
    }

    @Test
    fun testCommittedReservationBumpsVersionNumber() = runBlocking {
        val storedName = "Report.pdf"
        val resId = ReservationUtils.encodeReservationId(testSourceId, "Docs/", storedName)
        val b2Key = ReservationUtils.buildB2ObjectKey(vaultId, testSourceId, "Docs/", storedName)

        val committedRes = NameReservation(
            reservationId = resId,
            sha256 = "existing_sha",
            b2ObjectKey = b2Key,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "Report.pdf",
            storedName = storedName,
            version = 0,
            status = ReservationStatus.COMMITTED,
            jobId = testJobId,
            ownerTaskId = "committed_task",
            createdAt = 1000L,
            expiresAt = 9999999L
        )
        reservationRepo.saveReservation(committedRes)

        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "Report.pdf",
            sha256 = "new_sha",
            size = 300L,
            lastModified = 2000L,
            status = FileStatus.HASHED
        )
        val fileId = fileRepo.addDiscoveredFile(file)
        val fileWithId = fileRepo.getFile(fileId)!!

        val result = resolver.reserveFilename(vaultId, fileWithId, "task-version-bump")

        // Committed name bumped version to (1)
        assertEquals("Report(1).pdf", result.storedName)
        assertEquals(1, result.version)
    }
}
