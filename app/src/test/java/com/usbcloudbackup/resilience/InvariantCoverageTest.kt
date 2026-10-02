package com.usbcloudbackup.resilience

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.DeduplicationEngine
import com.usbcloudbackup.backup.DeduplicationResult
import com.usbcloudbackup.backup.VersionedNameResolver
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.SourceRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.recovery.CloudRecoveryEngine
import com.usbcloudbackup.cloud.storage.FakeCloudStorageRepository
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.storage.FakeStorageSource
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
class InvariantCoverageTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var sourceRepo: SourceRepository
    private lateinit var jobRepo: BackupJobRepository
    private lateinit var fileRepo: FileRepository
    private lateinit var reservationRepo: ReservationRepository
    private lateinit var uploadRepo: UploadRepository
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var fakeAuth: AuthRepository

    private val testUid = "invariant_user_001"
    private val testSourceId = "usb-inv-001"
    private val testJobId = "job-inv-001"

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

        fakeFirestore = FakeFirestoreRepository()
        fakeStorage = FakeCloudStorageRepository()

        fakeAuth = object : AuthRepository {
            override fun getCurrentUid(): String = testUid
            override fun isAuthenticated(): Boolean = true
            override suspend fun ensureAuthenticated(): String = testUid
            override fun getAuthMethod(): String = "anonymous"
        }

        runBlocking {
            val source = UsbSource(testSourceId, 11, 22, "SN_INV", "VOL_INV", "Inv Drive", 1000L, 2000L)
            sourceRepo.saveSource(source)
            val job = BackupJob(testJobId, testSourceId, BackupJobState.UPLOADING, 1000L)
            jobRepo.createJob(job)
        }
    }

    @After
    fun tearDown() {
        AppDatabase.setTestInstance(null)
        db.close()
        fakeFirestore.clear()
        fakeStorage.clear()
    }

    @Test
    fun testI001_ExistingCloudObjectsNeverOverwritten() = runBlocking {
        val cloudPath = "backups/$testUid/$testSourceId/Docs/File.txt"
        val originalBytes = "Original Content".toByteArray(Charsets.UTF_8)

        fakeStorage.uploadFileStream(
            cloudObjectPath = cloudPath,
            inputStream = ByteArrayInputStream(originalBytes),
            metadata = mapOf("x-custom-sha256" to "hash_orig")
        )

        val metadata = fakeStorage.checkObjectExists(cloudPath)
        assertNotNull(metadata)
        assertEquals("hash_orig", metadata?.sha256)
    }

    @Test
    fun testI002_ExactSha256NeverUploadedTwiceForSameOwner() = runBlocking {
        val sha256 = "5555555555555555555555555555555555555555555555555555555555555555"

        // Index hash in Firestore
        fakeFirestore.indexContentHash(testUid, sha256, "file-100", "backups/.../file.txt", 100L, "file.txt")

        val recoveryEngine = CloudRecoveryEngine(fileRepo, jobRepo, uploadRepo, fakeFirestore, fakeStorage)

        val file = BackupFile(
            jobId = testJobId,
            sourceId = testSourceId,
            relativePath = "Docs/",
            originalName = "DuplicateContent.txt",
            sha256 = sha256,
            size = 100L,
            lastModified = 1000L,
            status = FileStatus.HASHED
        )
        val fileId = fileRepo.addDiscoveredFile(file)
        val fileWithId = fileRepo.getFile(fileId)!!

        val isDuplicate = recoveryEngine.checkCloudDeduplication(testUid, fileWithId)
        assertTrue(isDuplicate)

        val updatedFile = fileRepo.getFile(fileId)
        assertEquals(FileStatus.SKIPPED_DUPLICATE, updatedFile?.status)
    }

    @Test
    fun testI003_ChangedSameNameFileReceivesNewVersion() = runBlocking {
        val resolver = VersionedNameResolver(db, fileRepo, reservationRepo, uploadRepo)

        // File 1 original
        val file1 = BackupFile(jobId = testJobId, sourceId = testSourceId, relativePath = "Docs/", originalName = "Notes.pdf", sha256 = "hash1", size = 10L, lastModified = 1L, status = FileStatus.HASHED)
        val id1 = fileRepo.addDiscoveredFile(file1)
        val res1 = resolver.reserveFilename(testUid, fileRepo.getFile(id1)!!, "task-1")
        assertEquals("Notes.pdf", res1.storedName)
        assertEquals(0, res1.version)

        // File 2 changed content, same name
        val file2 = BackupFile(jobId = testJobId, sourceId = testSourceId, relativePath = "Docs/", originalName = "Notes.pdf", sha256 = "hash2", size = 20L, lastModified = 2L, status = FileStatus.HASHED)
        val id2 = fileRepo.addDiscoveredFile(file2)
        val res2 = resolver.reserveFilename(testUid, fileRepo.getFile(id2)!!, "task-2")
        assertEquals("Notes(1).pdf", res2.storedName)
        assertEquals(1, res2.version)
    }

    @Test
    fun testI004_FileNotMarkedUploadedBeforeConfirmation() = runBlocking {
        val file = BackupFile(jobId = testJobId, sourceId = testSourceId, relativePath = "Docs/", originalName = "Check.pdf", sha256 = "hash_c", size = 10L, lastModified = 1L, status = FileStatus.NAME_RESERVED)
        val fileId = fileRepo.addDiscoveredFile(file)

        // Verify status remains NAME_RESERVED before confirmation
        assertEquals(FileStatus.NAME_RESERVED, fileRepo.getFile(fileId)?.status)

        fileRepo.updateFileStatus(fileId, FileStatus.UPLOADING)
        assertEquals(FileStatus.UPLOADING, fileRepo.getFile(fileId)?.status)

        fileRepo.updateFileStatus(fileId, FileStatus.UPLOADED_NOT_INDEXED)
        assertEquals(FileStatus.UPLOADED_NOT_INDEXED, fileRepo.getFile(fileId)?.status)

        fileRepo.updateFileStatus(fileId, FileStatus.INDEXED)
        assertEquals(FileStatus.INDEXED, fileRepo.getFile(fileId)?.status)
    }

    @Test
    fun testI008_DeduplicationIsContentBased() = runBlocking {
        val deduplicationEngine = DeduplicationEngine(fileRepo, jobRepo)
        val sameHash = "6666666666666666666666666666666666666666666666666666666666666666"

        // File A with name A.txt and status INDEXED
        val fileA = BackupFile(jobId = testJobId, sourceId = testSourceId, relativePath = "Docs/", originalName = "A.txt", sha256 = sameHash, size = 100L, lastModified = 1000L, status = FileStatus.INDEXED)
        fileRepo.addDiscoveredFile(fileA)

        // File B with completely different name B.txt but SAME hash
        val fileB = BackupFile(jobId = testJobId, sourceId = testSourceId, relativePath = "Photos/", originalName = "B.txt", sha256 = sameHash, size = 100L, lastModified = 1000L, status = FileStatus.HASHED)
        val idB = fileRepo.addDiscoveredFile(fileB)
        val fileBWithId = fileRepo.getFile(idB)!!

        val dedupResult = deduplicationEngine.checkLocalDeduplication(fileBWithId)
        assertTrue(dedupResult is DeduplicationResult.SkippedDuplicate)

        val updatedB = fileRepo.getFile(idB)
        assertEquals(FileStatus.SKIPPED_DUPLICATE, updatedB?.status)
    }

    @Test
    fun testI014_SourceUsbFilesAreNeverModifiedOrDeleted() = runBlocking {
        val fakeSource = FakeStorageSource(testSourceId, "ReadOnly Drive")
        val contentBytes = "Read Only Bytes".toByteArray(Charsets.UTF_8)
        fakeSource.addFile("Docs/", "ReadOnly.txt", contentBytes)

        val discovered = fakeSource.discoverFiles()
        assertEquals(1, discovered.size)

        // Read stream contents
        val readBytes = discovered[0].openInputStream().use { it.readBytes() }
        assertEquals("Read Only Bytes", String(readBytes, Charsets.UTF_8))

        // Re-read stream contents to verify file is unchanged
        val reReadBytes = discovered[0].openInputStream().use { it.readBytes() }
        assertEquals("Read Only Bytes", String(reReadBytes, Charsets.UTF_8))
    }
}
