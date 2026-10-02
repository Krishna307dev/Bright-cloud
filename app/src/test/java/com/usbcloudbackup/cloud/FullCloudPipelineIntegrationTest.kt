package com.usbcloudbackup.cloud

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.DeduplicationEngine
import com.usbcloudbackup.backup.DeduplicationResult
import com.usbcloudbackup.backup.VersionedNameResolver
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UploadTaskState
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.ReservationRepository
import com.usbcloudbackup.backup.repository.UploadRepository
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.recovery.CloudRecoveryEngine
import com.usbcloudbackup.cloud.storage.FakeCloudStorageRepository
import com.usbcloudbackup.config.VaultConfig
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
class FullCloudPipelineIntegrationTest {

    private lateinit var db: AppDatabase
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var reservationRepository: ReservationRepository
    private lateinit var uploadRepository: UploadRepository

    private lateinit var scanner: FileScanner
    private lateinit var deduplicationEngine: DeduplicationEngine
    private lateinit var nameResolver: VersionedNameResolver
    private lateinit var fakeFirestore: FakeFirestoreRepository
    private lateinit var fakeStorage: FakeCloudStorageRepository
    private lateinit var cloudRecoveryEngine: CloudRecoveryEngine

    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val sourceId = "usb-cloud-test-001"
    private val jobId = "job-cloud-e2e-001"

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

        fakeFirestore = FakeFirestoreRepository()
        fakeStorage = FakeCloudStorageRepository()

        cloudRecoveryEngine = CloudRecoveryEngine(
            fileRepository = fileRepository,
            jobRepository = jobRepository,
            uploadRepository = uploadRepository,
            firestoreRepository = fakeFirestore,
            cloudStorageRepository = fakeStorage
        )
    }

    @After
    fun tearDown() {
        db.close()
        fakeFirestore.clear()
        fakeStorage.clear()
    }

    @Test
    fun testFullEndToEndCloudBackupPipeline() {
        runBlocking {
            val source = UsbSource(sourceId, 1234, 5678, "SN_E2E", "VOL_E2E", "E2E Cloud USB", 1000L, 2000L)
            db.sourceDao().insertSource(source.toEntity())
            fakeFirestore.saveSource(vaultId, source)

            val job = BackupJob(jobId, sourceId, BackupJobState.SCANNING, System.currentTimeMillis())
            jobRepository.createJob(job)
            fakeFirestore.updateBackupJobState(vaultId, job)

            // Setup 3 virtual files on USB:
            // File 1: Notes/Math/Chapter1.pdf (Content AAA)
            // File 2: Backup/Notes/Chapter1_dup.pdf (Content AAA - duplicate, must be SKIPPED)
            // File 3: Notes/Math/Chapter1_new.pdf (Content BBB - unique content)
            val contentAAA = "Content AAA for E2E Cloud Test".toByteArray(Charsets.UTF_8)
            val contentBBB = "Content BBB (Different) for E2E Cloud Test".toByteArray(Charsets.UTF_8)

            val fakeSource = FakeStorageSource(sourceId, "E2E Cloud USB")
            fakeSource.addFile("Notes/Math/", "Chapter1.pdf", contentAAA)
            fakeSource.addFile("Backup/Notes/", "Chapter1_dup.pdf", contentAAA)
            fakeSource.addFile("Notes/Math/", "Chapter1_new.pdf", contentBBB)

            // Step 1: Discover
            val discoveredFiles = scanner.scanSource(jobId, fakeSource)
            assertEquals(3, discoveredFiles.size)

            // Step 2: Streaming SHA-256 Hashing
            val descriptorsMap = fakeSource.discoverFiles().associateBy { "${it.relativePath}${it.originalName}" }
            for (file in discoveredFiles) {
                val key = "${file.relativePath}${file.originalName}"
                val descriptor = descriptorsMap[key]!!

                fileRepository.updateFileStatus(file.id, FileStatus.HASHING)
                val hash = Sha256Calculator.calculateHash(descriptor.openInputStream())
                fileRepository.updateFileHash(file.id, hash, FileStatus.HASHED)
            }

            // Step 3: Local & Cloud Deduplication + Filename Reservation + Cloud Upload & Finalization
            val hashedFiles = fileRepository.getFilesForJob(jobId)

            for (file in hashedFiles) {
                // 3a. Local Room deduplication check
                val localDedup = deduplicationEngine.checkLocalDeduplication(file)
                if (localDedup is DeduplicationResult.SkippedDuplicate) continue

                // 3b. Cloud Firestore content hash deduplication check
                val isCloudDuplicate = cloudRecoveryEngine.checkCloudDeduplication(vaultId, file)
                if (isCloudDuplicate) continue

                // 3c. Cloud filename reservation
                val ownerTaskId = "task-worker-${file.id}"
                val cloudRes = fakeFirestore.reserveCloudFilename(
                    vaultId = vaultId,
                    sourceId = file.sourceId,
                    relativePath = file.relativePath,
                    originalName = file.originalName,
                    sha256 = file.sha256!!,
                    jobId = jobId,
                    ownerTaskId = ownerTaskId
                )

                // Also record in local Room DB
                nameResolver.reserveFilename(vaultId, file, ownerTaskId)

                val key = "${file.relativePath}${file.originalName}"
                val descriptor = descriptorsMap[key]!!

                val task = uploadRepository.getTaskForFile(file.id)!!

                // 3d. Upload to Cloud Storage & Finalize in Firestore
                val success = cloudRecoveryEngine.processOrRecoverUpload(
                    vaultId = vaultId,
                    file = fileRepository.getFile(file.id)!!,
                    task = task,
                    inputStreamProvider = { descriptor.openInputStream() }
                )
                assertTrue(success)
            }

            // Step 4: Verify Final Database and Cloud States
            val finalFiles = fileRepository.getFilesForJob(jobId)
            assertEquals(3, finalFiles.size)

            val skippedFiles = finalFiles.filter { it.status == FileStatus.SKIPPED_DUPLICATE }
            val indexedFiles = finalFiles.filter { it.status == FileStatus.INDEXED }

            assertEquals(1, skippedFiles.size)
            assertEquals(2, indexedFiles.size)

            // Verify Cloud Storage uploaded bytes
            assertEquals(2, fakeStorage.getStoredObjectCount())

            // Verify Firestore records written
            assertEquals(2, fakeFirestore.files.size)
            assertEquals(2, fakeFirestore.contentHashes.size)

            // Verify all unfinished tasks are completed
            val unfinished = uploadRepository.getUnfinishedTasks()
            assertEquals(0, unfinished.size)
        }
    }
}
