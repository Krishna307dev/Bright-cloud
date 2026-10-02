package com.usbcloudbackup.backup

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.database.AppDatabase
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VersionedNameResolverTest {

    private lateinit var db: AppDatabase
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var reservationRepository: ReservationRepository
    private lateinit var uploadRepository: UploadRepository
    private lateinit var resolver: VersionedNameResolver

    private val testUid = "user_abc_123"
    private val testSourceId = "src-usb-001"
    private val testJobId = "job-001"

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
        resolver = VersionedNameResolver(db, fileRepository, reservationRepository, uploadRepository, jobRepository)

        runBlocking {
            val source = UsbSource(testSourceId, 1234, 5678, "SN001", "VOL1", "Test USB", 1000L, 2000L)
            db.sourceDao().insertSource(source.toEntity())
            val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
            jobRepository.createJob(job)
        }
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun testBasicSequentialVersioning() {
        runBlocking {
            // File 1: CHAPTER_5.pdf
            val file1 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Notes/Math/",
                originalName = "CHAPTER_5.pdf",
                sha256 = "1111111111111111111111111111111111111111111111111111111111111111",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val file1Id = fileRepository.addDiscoveredFile(file1)
            val file1WithId = fileRepository.getFile(file1Id)!!

            val res1 = resolver.reserveFilename(testUid, file1WithId, "task-1")
            assertEquals("CHAPTER_5.pdf", res1.storedName)
            assertEquals(0, res1.version)
            assertFalse(res1.isReused)

            // File 2: CHAPTER_5.pdf (different content)
            val file2 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Notes/Math/",
                originalName = "CHAPTER_5.pdf",
                sha256 = "2222222222222222222222222222222222222222222222222222222222222222",
                size = 120L,
                lastModified = 2000L,
                status = FileStatus.HASHED
            )
            val file2Id = fileRepository.addDiscoveredFile(file2)
            val file2WithId = fileRepository.getFile(file2Id)!!

            val res2 = resolver.reserveFilename(testUid, file2WithId, "task-2")
            assertEquals("CHAPTER_5(1).pdf", res2.storedName)
            assertEquals(1, res2.version)

            // File 3: CHAPTER_5.pdf (yet another content)
            val file3 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Notes/Math/",
                originalName = "CHAPTER_5.pdf",
                sha256 = "3333333333333333333333333333333333333333333333333333333333333333",
                size = 150L,
                lastModified = 3000L,
                status = FileStatus.HASHED
            )
            val file3Id = fileRepository.addDiscoveredFile(file3)
            val file3WithId = fileRepository.getFile(file3Id)!!

            val res3 = resolver.reserveFilename(testUid, file3WithId, "task-3")
            assertEquals("CHAPTER_5(2).pdf", res3.storedName)
            assertEquals(2, res3.version)
        }
    }

    @Test
    fun testMultiExtensionAndExtensionlessVersioning() {
        runBlocking {
            // Multi-extension file: archive.tar.gz -> archive.tar(1).gz
            val tar1 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Archives/",
                originalName = "archive.tar.gz",
                sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                size = 500L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val tar1Id = fileRepository.addDiscoveredFile(tar1)
            val resTar1 = resolver.reserveFilename(testUid, fileRepository.getFile(tar1Id)!!, "task-tar1")
            assertEquals("archive.tar.gz", resTar1.storedName)

            val tar2 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Archives/",
                originalName = "archive.tar.gz",
                sha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                size = 600L,
                lastModified = 2000L,
                status = FileStatus.HASHED
            )
            val tar2Id = fileRepository.addDiscoveredFile(tar2)
            val resTar2 = resolver.reserveFilename(testUid, fileRepository.getFile(tar2Id)!!, "task-tar2")
            assertEquals("archive.tar(1).gz", resTar2.storedName)

            // Extensionless file: README -> README(1)
            val readme1 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "README",
                sha256 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val readme1Id = fileRepository.addDiscoveredFile(readme1)
            val resReadme1 = resolver.reserveFilename(testUid, fileRepository.getFile(readme1Id)!!, "task-readme1")
            assertEquals("README", resReadme1.storedName)

            val readme2 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "README",
                sha256 = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                size = 150L,
                lastModified = 2000L,
                status = FileStatus.HASHED
            )
            val readme2Id = fileRepository.addDiscoveredFile(readme2)
            val resReadme2 = resolver.reserveFilename(testUid, fileRepository.getFile(readme2Id)!!, "task-readme2")
            assertEquals("README(1)", resReadme2.storedName)
        }
    }

    @Test
    fun testPathScopingNoCrossDirectoryCollision() {
        runBlocking {
            // Notes/Math/CHAPTER_5.pdf
            val mathFile = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Notes/Math/",
                originalName = "CHAPTER_5.pdf",
                sha256 = "1111111111111111111111111111111111111111111111111111111111111111",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val mathId = fileRepository.addDiscoveredFile(mathFile)
            val resMath = resolver.reserveFilename(testUid, fileRepository.getFile(mathId)!!, "task-math")
            assertEquals("CHAPTER_5.pdf", resMath.storedName)

            // Science/CHAPTER_5.pdf (different path, should NOT collide)
            val scienceFile = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Science/",
                originalName = "CHAPTER_5.pdf",
                sha256 = "2222222222222222222222222222222222222222222222222222222222222222",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val scienceId = fileRepository.addDiscoveredFile(scienceFile)
            val resScience = resolver.reserveFilename(testUid, fileRepository.getFile(scienceId)!!, "task-science")
            assertEquals("CHAPTER_5.pdf", resScience.storedName)
        }
    }

    @Test
    fun test24HourTTLExpirationOverwrite() {
        runBlocking {
            val oldJobId = "old-job-001"
            jobRepository.createJob(BackupJob(oldJobId, testSourceId, BackupJobState.FAILED, 100L))

            val now = System.currentTimeMillis()

            val file1 = BackupFile(
                jobId = oldJobId,
                sourceId = testSourceId,
                relativePath = "Docs/",
                originalName = "Report.pdf",
                sha256 = "1111111111111111111111111111111111111111111111111111111111111111",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val file1Id = fileRepository.addDiscoveredFile(file1)
            val file1WithId = fileRepository.getFile(file1Id)!!

            // Reserve at time `now - 25 hours` (already expired)
            val oldTime = now - (25 * 60 * 60 * 1000L)
            val resOld = resolver.reserveFilename(testUid, file1WithId, "old-task", currentTime = oldTime)
            assertEquals("Report.pdf", resOld.storedName)

            val expiredRes = reservationRepository.getReservation(resOld.reservationId)
            assertNotNull(expiredRes)
            assertEquals(ReservationStatus.PENDING, expiredRes?.status)
            assertTrue(expiredRes!!.expiresAt < now)

            // Simulate expired task cleanup by setting file1 status to FAILED
            fileRepository.updateFileStatus(file1Id, FileStatus.FAILED)

            // New job attempts to reserve Report.pdf at current time `now`
            val file2 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Docs/",
                originalName = "Report.pdf",
                sha256 = "2222222222222222222222222222222222222222222222222222222222222222",
                size = 120L,
                lastModified = 2000L,
                status = FileStatus.HASHED
            )
            val file2Id = fileRepository.addDiscoveredFile(file2)
            val file2WithId = fileRepository.getFile(file2Id)!!

            val resNew = resolver.reserveFilename(testUid, file2WithId, "new-task", currentTime = now)
            // Expired reservation should be overwritten, allowing new job to claim Report.pdf
            assertEquals("Report.pdf", resNew.storedName)
            assertEquals(0, resNew.version)
        }
    }

    @Test
    fun testCrashRecoveryAndIdempotentRetry() {
        runBlocking {
            val file1 = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Notes/",
                originalName = "Lecture.pdf",
                sha256 = "1111111111111111111111111111111111111111111111111111111111111111",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val file1Id = fileRepository.addDiscoveredFile(file1)
            val file1WithId = fileRepository.getFile(file1Id)!!

            // Initial reservation
            val resInitial = resolver.reserveFilename(testUid, file1WithId, "task-crash-1")
            assertEquals("Lecture.pdf", resInitial.storedName)
            assertFalse(resInitial.isReused)

            // Simulate crash & worker restart: call reserveFilename again for same fileId
            val file1AfterCrash = fileRepository.getFile(file1Id)!!
            val resRetry = resolver.reserveFilename(testUid, file1AfterCrash, "task-crash-1")

            assertEquals("Lecture.pdf", resRetry.storedName)
            assertEquals(0, resRetry.version)
            assertTrue(resRetry.isReused)
        }
    }

    @Test
    fun testConcurrentReservationsSafety() {
        runBlocking {
            val executor = Executors.newFixedThreadPool(4)
            val dispatcher = executor.asCoroutineDispatcher()

            val fileA = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Shared/",
                originalName = "Data.csv",
                sha256 = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val fileB = BackupFile(
                jobId = testJobId,
                sourceId = testSourceId,
                relativePath = "Shared/",
                originalName = "Data.csv",
                sha256 = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
                size = 120L,
                lastModified = 2000L,
                status = FileStatus.HASHED
            )

            val idA = fileRepository.addDiscoveredFile(fileA)
            val idB = fileRepository.addDiscoveredFile(fileB)

            val fileAWithId = fileRepository.getFile(idA)!!
            val fileBWithId = fileRepository.getFile(idB)!!

            // Execute two reservation attempts concurrently on background threads
            val deferredA = async(dispatcher) {
                resolver.reserveFilename(testUid, fileAWithId, "task-concurrent-A")
            }
            val deferredB = async(dispatcher) {
                resolver.reserveFilename(testUid, fileBWithId, "task-concurrent-B")
            }

            val results = listOf(deferredA, deferredB).awaitAll()

            val storedNames = results.map { it.storedName }.toSet()
            assertEquals(2, storedNames.size)
            assertTrue(storedNames.contains("Data.csv"))
            assertTrue(storedNames.contains("Data(1).csv"))

            executor.shutdown()
            executor.awaitTermination(5, TimeUnit.SECONDS)
        }
    }

    @Test
    fun testReclaimPendingReservationFromTerminalJobWithSameSha() {
        runBlocking {
            val oldJobId = "old-terminal-job"
            jobRepository.createJob(BackupJob(oldJobId, testSourceId, BackupJobState.FAILED, 100L))

            val now = System.currentTimeMillis()
            val oldFile = BackupFile(
                jobId = oldJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "HUMAN_EYE.pdf",
                sha256 = "hash-eye-12817",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val oldFileId = fileRepository.addDiscoveredFile(oldFile)
            val resOld = resolver.reserveFilename(testUid, fileRepository.getFile(oldFileId)!!, "task-old", currentTime = now)
            assertEquals("HUMAN_EYE.pdf", resOld.storedName)
            assertEquals(0, resOld.version)

            // Verify old reservation is PENDING and not expired
            val savedRes = reservationRepository.getReservation(resOld.reservationId)
            assertNotNull(savedRes)
            assertEquals(ReservationStatus.PENDING, savedRes!!.status)
            assertEquals(oldJobId, savedRes.jobId)

            // New job arrives with SAME SHA-256
            val newJobId = "new-job-002"
            jobRepository.createJob(BackupJob(newJobId, testSourceId, BackupJobState.UPLOADING, now + 100L))

            val newFile = BackupFile(
                jobId = newJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "HUMAN_EYE.pdf",
                sha256 = "hash-eye-12817",
                size = 100L,
                lastModified = 2000L,
                status = FileStatus.HASHED
            )
            val newFileId = fileRepository.addDiscoveredFile(newFile)
            val resNew = resolver.reserveFilename(testUid, fileRepository.getFile(newFileId)!!, "task-new", currentTime = now + 100L)

            // Must reclaim the SAME version 0 and not increment to HUMAN_EYE(1).pdf
            assertEquals("HUMAN_EYE.pdf", resNew.storedName)
            assertEquals(0, resNew.version)

            // Check reservation is updated to new job and ownerTaskId
            val reboundRes = reservationRepository.getReservation(resNew.reservationId)
            assertNotNull(reboundRes)
            assertEquals(newJobId, reboundRes!!.jobId)
            assertEquals("task-new", reboundRes.ownerTaskId)
        }
    }

    @Test
    fun testDoNotReclaimPendingReservationFromTerminalJobWithDifferentSha() {
        runBlocking {
            val oldJobId = "old-terminal-job-diff"
            jobRepository.createJob(BackupJob(oldJobId, testSourceId, BackupJobState.COMPLETED, 100L))

            val now = System.currentTimeMillis()
            val oldFile = BackupFile(
                jobId = oldJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "HUMAN_EYE.pdf",
                sha256 = "hash-eye-original",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val oldFileId = fileRepository.addDiscoveredFile(oldFile)
            val resOld = resolver.reserveFilename(testUid, fileRepository.getFile(oldFileId)!!, "task-old", currentTime = now)
            assertEquals("HUMAN_EYE.pdf", resOld.storedName)

            // New job arrives with DIFFERENT SHA-256
            val newJobId = "new-job-diff"
            jobRepository.createJob(BackupJob(newJobId, testSourceId, BackupJobState.UPLOADING, now + 100L))

            val newFile = BackupFile(
                jobId = newJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "HUMAN_EYE.pdf",
                sha256 = "hash-eye-modified",
                size = 120L,
                lastModified = 2000L,
                status = FileStatus.HASHED
            )
            val newFileId = fileRepository.addDiscoveredFile(newFile)
            val resNew = resolver.reserveFilename(testUid, fileRepository.getFile(newFileId)!!, "task-new", currentTime = now + 100L)

            // Must NOT reclaim, must advance to HUMAN_EYE(1).pdf
            assertEquals("HUMAN_EYE(1).pdf", resNew.storedName)
            assertEquals(1, resNew.version)
        }
    }

    @Test
    fun testDoNotReclaimPendingReservationFromLiveJob() {
        runBlocking {
            val liveJobId = "live-in-flight-job"
            jobRepository.createJob(BackupJob(liveJobId, testSourceId, BackupJobState.UPLOADING, 100L))

            val now = System.currentTimeMillis()
            val liveFile = BackupFile(
                jobId = liveJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "HUMAN_EYE.pdf",
                sha256 = "hash-eye-same",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val liveFileId = fileRepository.addDiscoveredFile(liveFile)
            val resLive = resolver.reserveFilename(testUid, fileRepository.getFile(liveFileId)!!, "task-live", currentTime = now)
            assertEquals("HUMAN_EYE.pdf", resLive.storedName)

            // Another concurrent job attempts with same SHA while liveJob is still in UPLOADING state
            val otherJobId = "other-live-job"
            jobRepository.createJob(BackupJob(otherJobId, testSourceId, BackupJobState.UPLOADING, now + 50L))

            val otherFile = BackupFile(
                jobId = otherJobId,
                sourceId = testSourceId,
                relativePath = "",
                originalName = "HUMAN_EYE.pdf",
                sha256 = "hash-eye-same",
                size = 100L,
                lastModified = 1000L,
                status = FileStatus.HASHED
            )
            val otherFileId = fileRepository.addDiscoveredFile(otherFile)
            val resOther = resolver.reserveFilename(testUid, fileRepository.getFile(otherFileId)!!, "task-other", currentTime = now + 50L)

            // Must NOT steal live job's reservation; must advance to version 1
            assertEquals("HUMAN_EYE(1).pdf", resOther.storedName)
            assertEquals(1, resOther.version)
        }
    }
}
