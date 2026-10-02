package com.usbcloudbackup.concurrency

import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.cloud.storage.FakeCloudStorageRepository
import com.usbcloudbackup.config.VaultConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
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
class MultiPhoneContentHashRaceTest {

    private lateinit var fakeFirestore: FakeFirestoreRepository
    private val vaultId = VaultConfig.DEFAULT_VAULT_ID

    @Before
    fun setup() {
        fakeFirestore = FakeFirestoreRepository()
    }

    @After
    fun tearDown() {
        fakeFirestore.clear()
    }

    @Test
    fun testConcurrentIdenticalFileUploadYieldsSingleCanonicalHashAndSingleFileDoc() = runBlocking {
        val testSha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        val sourceId = "shared-usb-drive-001"
        val relativePath = "Documents/"
        val originalName = "report.pdf"

        val jobA = BackupJob("job-phone-a", sourceId, BackupJobState.UPLOADING, System.currentTimeMillis())
        val jobB = BackupJob("job-phone-b", sourceId, BackupJobState.UPLOADING, System.currentTimeMillis())
        fakeFirestore.backupJobs["${vaultId}_${jobA.jobId}"] = jobA
        fakeFirestore.backupJobs["${vaultId}_${jobB.jobId}"] = jobB

        // Phone A reserves name first (version 0: report.pdf)
        val resA = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            sha256 = testSha,
            jobId = jobA.jobId,
            ownerTaskId = "task-phone-a"
        )
        assertEquals("report.pdf", resA.storedName)
        assertEquals(0, resA.version)

        // Phone B concurrently attempts reservation for same file before Phone A commits.
        // Because version 0 is PENDING, Phone B gets version 1: report(1).pdf
        val resB = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            sha256 = testSha,
            jobId = jobB.jobId,
            ownerTaskId = "task-phone-b"
        )
        assertEquals("report(1).pdf", resB.storedName)
        assertEquals(1, resB.version)

        val fileA = BackupFile(
            id = 1L,
            jobId = jobA.jobId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            size = 2048L,
            lastModified = 1000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )
        val fileB = BackupFile(
            id = 2L,
            jobId = jobB.jobId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            size = 2048L,
            lastModified = 1000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )

        // Phone A finishes B2 upload and finalizes transaction first
        val fileAId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileA,
            storedName = resA.storedName,
            b2ObjectKey = resA.b2ObjectKey,
            reservationId = resA.reservationId,
            jobId = jobA.jobId
        )

        // Phone B finishes B2 upload and finalizes transaction second
        val fileBId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileB,
            storedName = resB.storedName,
            b2ObjectKey = resB.b2ObjectKey,
            reservationId = resB.reservationId,
            jobId = jobB.jobId
        )

        // 1. Both phones resolve to the SAME canonical fileId
        assertEquals("Phone B must adopt Phone A's canonical file ID", fileAId, fileBId)

        // 2. Exactly ONE canonical hash document exists in contentHashes
        assertEquals(1, fakeFirestore.contentHashes.size)
        val hashDoc = fakeFirestore.contentHashes["${vaultId}_$testSha"]
        assertNotNull(hashDoc)
        assertEquals(fileAId, hashDoc!!["fileId"])
        assertEquals(resA.b2ObjectKey, hashDoc["b2ObjectKey"])

        // 3. Exactly ONE file document exists in files collection (no duplicate logical files)
        assertEquals(1, fakeFirestore.files.size)
        val canonicalFile = fakeFirestore.files["${vaultId}_$fileAId"]
        assertNotNull(canonicalFile)
        assertEquals(sourceId, canonicalFile!!["sourceId"])
        assertEquals(relativePath, canonicalFile["relativePath"])
        assertEquals(originalName, canonicalFile["originalName"])
        assertEquals("report.pdf", canonicalFile["storedName"])

        // 4. Phone A's reservation is COMMITTED, and Phone B's redundant reservation is EXPIRED
        val resDocA = fakeFirestore.nameReservations["${vaultId}_${resA.reservationId}"]
        val resDocB = fakeFirestore.nameReservations["${vaultId}_${resB.reservationId}"]
        assertNotNull(resDocA)
        assertNotNull(resDocB)
        assertEquals("COMMITTED", resDocA!!["status"])
        assertEquals("EXPIRED", resDocB!!["status"])

        // 5. Job counters: Phone A uploaded 1, Phone B skipped 1
        val updatedJobA = fakeFirestore.backupJobs["${vaultId}_${jobA.jobId}"]
        val updatedJobB = fakeFirestore.backupJobs["${vaultId}_${jobB.jobId}"]
        assertEquals(1, updatedJobA!!.uploadedFiles)
        assertEquals(0, updatedJobA.skippedFiles)
        assertEquals(0, updatedJobB!!.uploadedFiles)
        assertEquals(1, updatedJobB.skippedFiles)
    }

    @Test
    fun testConcurrentDifferentDeviceSameHashSharesCanonicalB2ObjectWithoutDuplicateHashDoc() = runBlocking {
        val testSha = "f0e4c2f76c58916ec258f246851bea091d14d4247a2fc3e18694461b1816e13b"
        val sourcePhoneA = "device-pixel-8"
        val sourcePhoneB = "device-galaxy-s24"
        val relativePath = "DCIM/Camera/"
        val originalName = "photo.jpg"

        val jobA = BackupJob("job-phone-a", sourcePhoneA, BackupJobState.UPLOADING, System.currentTimeMillis())
        val jobB = BackupJob("job-phone-b", sourcePhoneB, BackupJobState.UPLOADING, System.currentTimeMillis())
        fakeFirestore.backupJobs["${vaultId}_${jobA.jobId}"] = jobA
        fakeFirestore.backupJobs["${vaultId}_${jobB.jobId}"] = jobB

        val resA = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourcePhoneA,
            relativePath = relativePath,
            originalName = originalName,
            sha256 = testSha,
            jobId = jobA.jobId,
            ownerTaskId = "task-a"
        )
        val resB = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourcePhoneB,
            relativePath = relativePath,
            originalName = originalName,
            sha256 = testSha,
            jobId = jobB.jobId,
            ownerTaskId = "task-b"
        )

        val fileA = BackupFile(
            id = 10L,
            jobId = jobA.jobId,
            sourceId = sourcePhoneA,
            relativePath = relativePath,
            originalName = originalName,
            size = 5000L,
            lastModified = 2000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )
        val fileB = BackupFile(
            id = 20L,
            jobId = jobB.jobId,
            sourceId = sourcePhoneB,
            relativePath = relativePath,
            originalName = originalName,
            size = 5000L,
            lastModified = 2000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )

        // Phone A finalizes first
        val fileAId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileA,
            storedName = resA.storedName,
            b2ObjectKey = resA.b2ObjectKey,
            reservationId = resA.reservationId,
            jobId = jobA.jobId
        )

        // Phone B finalizes second (cross-device: different sourceId, but identical content)
        val fileBId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileB,
            storedName = resB.storedName,
            b2ObjectKey = resB.b2ObjectKey,
            reservationId = resB.reservationId,
            jobId = jobB.jobId
        )

        // Two distinct logical file entries (one per device)
        assertEquals(2, fakeFirestore.files.size)
        assertTrue(fileAId != fileBId)

        val docA = fakeFirestore.files["${vaultId}_$fileAId"]
        val docB = fakeFirestore.files["${vaultId}_$fileBId"]
        assertNotNull(docA)
        assertNotNull(docB)
        assertEquals(sourcePhoneA, docA!!["sourceId"])
        assertEquals(sourcePhoneB, docB!!["sourceId"])

        // But both share the canonical B2 object key from Phone A
        assertEquals(resA.b2ObjectKey, docA["b2ObjectKey"])
        assertEquals(resA.b2ObjectKey, docB["b2ObjectKey"])

        // Exactly ONE contentHashes record
        assertEquals(1, fakeFirestore.contentHashes.size)
        val canonicalHash = fakeFirestore.contentHashes["${vaultId}_$testSha"]
        assertNotNull(canonicalHash)
        assertEquals(fileAId, canonicalHash!!["fileId"])
        assertEquals(resA.b2ObjectKey, canonicalHash["b2ObjectKey"])

        // Both reservations committed
        val resDocA = fakeFirestore.nameReservations["${vaultId}_${resA.reservationId}"]
        val resDocB = fakeFirestore.nameReservations["${vaultId}_${resB.reservationId}"]
        assertEquals("COMMITTED", resDocA!!["status"])
        assertEquals("COMMITTED", resDocB!!["status"])
    }

    @Test
    fun testFinalizeRetryIdempotency() = runBlocking {
        val testSha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        val sourceId = "usb-retry-device"
        val relativePath = "Data/"
        val originalName = "sample.dat"

        val job = BackupJob("job-retry", sourceId, BackupJobState.UPLOADING, System.currentTimeMillis())
        fakeFirestore.backupJobs["${vaultId}_${job.jobId}"] = job

        val res = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            sha256 = testSha,
            jobId = job.jobId,
            ownerTaskId = "task-retry"
        )

        val file = BackupFile(
            id = 99L,
            jobId = job.jobId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            size = 1024L,
            lastModified = 3000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )

        // First attempt succeeds
        val firstFileId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = file,
            storedName = res.storedName,
            b2ObjectKey = res.b2ObjectKey,
            reservationId = res.reservationId,
            jobId = job.jobId
        )

        // Second attempt (retry of same logical file by same or another worker)
        val secondFileId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = file,
            storedName = res.storedName,
            b2ObjectKey = res.b2ObjectKey,
            reservationId = res.reservationId,
            jobId = job.jobId
        )

        // Must return identical canonical file ID without creating a duplicate file document
        assertEquals(firstFileId, secondFileId)
        assertEquals(1, fakeFirestore.files.size)
        assertEquals(1, fakeFirestore.contentHashes.size)
    }

    @Test
    fun testConcurrentMultiThreadedFinalizeExecution() = runBlocking {
        val testSha = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        val sourceId = "usb-multi-thread"
        val relativePath = ""
        val originalName = "hello.txt"

        val jobA = BackupJob("job-thread-a", sourceId, BackupJobState.UPLOADING, System.currentTimeMillis())
        val jobB = BackupJob("job-thread-b", sourceId, BackupJobState.UPLOADING, System.currentTimeMillis())
        fakeFirestore.backupJobs["${vaultId}_${jobA.jobId}"] = jobA
        fakeFirestore.backupJobs["${vaultId}_${jobB.jobId}"] = jobB

        val resA = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            sha256 = testSha,
            jobId = jobA.jobId,
            ownerTaskId = "task-a"
        )
        val resB = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            sha256 = testSha,
            jobId = jobB.jobId,
            ownerTaskId = "task-b"
        )

        val fileA = BackupFile(
            id = 1L,
            jobId = jobA.jobId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            size = 12L,
            lastModified = 4000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )
        val fileB = BackupFile(
            id = 2L,
            jobId = jobB.jobId,
            sourceId = sourceId,
            relativePath = relativePath,
            originalName = originalName,
            size = 12L,
            lastModified = 4000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )

        val deferredA = async(Dispatchers.Default) {
            fakeFirestore.finalizeUploadTransaction(
                vaultId = vaultId,
                file = fileA,
                storedName = resA.storedName,
                b2ObjectKey = resA.b2ObjectKey,
                reservationId = resA.reservationId,
                jobId = jobA.jobId
            )
        }
        val deferredB = async(Dispatchers.Default) {
            fakeFirestore.finalizeUploadTransaction(
                vaultId = vaultId,
                file = fileB,
                storedName = resB.storedName,
                b2ObjectKey = resB.b2ObjectKey,
                reservationId = resB.reservationId,
                jobId = jobB.jobId
            )
        }

        val idA = deferredA.await()
        val idB = deferredB.await()

        // One of them was canonical and the other adopted it
        assertEquals(idA, idB)
        assertEquals(1, fakeFirestore.contentHashes.size)
        assertEquals(1, fakeFirestore.files.size)
    }

    @Test
    fun testConcurrentSameShaUploadCleansUpRedundantB2ObjectLeavingSingleCanonicalObject() = runBlocking {
        val fakeStorage = FakeCloudStorageRepository()
        val vaultId = "test_vault"
        val testSha = "3333333333333333333333333333333333333333333333333333333333333333"

        // Phone A and Phone B on different devices/sources with identical file content
        val sourceA = "src_phone_a"
        val sourceB = "src_phone_b"
        val jobA = BackupJob("job_a", sourceA, BackupJobState.UPLOADING, System.currentTimeMillis())
        val jobB = BackupJob("job_b", sourceB, BackupJobState.UPLOADING, System.currentTimeMillis())
        fakeFirestore.backupJobs["${vaultId}_${jobA.jobId}"] = jobA
        fakeFirestore.backupJobs["${vaultId}_${jobB.jobId}"] = jobB

        val resA = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceA,
            relativePath = "",
            originalName = "document.pdf",
            sha256 = testSha,
            jobId = jobA.jobId,
            ownerTaskId = "task_a"
        )
        val resB = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceB,
            relativePath = "",
            originalName = "document.pdf",
            sha256 = testSha,
            jobId = jobB.jobId,
            ownerTaskId = "task_b"
        )

        // Both Phone A and Phone B upload bytes concurrently to Backblaze B2 before finalization discovers hash
        fakeStorage.uploadFileStream(
            cloudObjectPath = resA.b2ObjectKey,
            inputStream = "content bytes".byteInputStream(),
            metadata = mapOf("x-custom-sha256" to testSha)
        )
        fakeStorage.uploadFileStream(
            cloudObjectPath = resB.b2ObjectKey,
            inputStream = "content bytes".byteInputStream(),
            metadata = mapOf("x-custom-sha256" to testSha)
        )

        // Verify that initially both objects exist in storage
        assertEquals(2, fakeStorage.getStoredObjectCount())
        assertNotNull(fakeStorage.checkObjectExists(resA.b2ObjectKey))
        assertNotNull(fakeStorage.checkObjectExists(resB.b2ObjectKey))

        val fileA = BackupFile(
            id = 101L,
            jobId = jobA.jobId,
            sourceId = sourceA,
            relativePath = "",
            originalName = "document.pdf",
            size = 13L,
            lastModified = 1000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )
        val fileB = BackupFile(
            id = 102L,
            jobId = jobB.jobId,
            sourceId = sourceB,
            relativePath = "",
            originalName = "document.pdf",
            size = 13L,
            lastModified = 1000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )

        // Phone A finalizes first -> establishes canonical hash
        val fileAId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileA,
            storedName = resA.storedName,
            b2ObjectKey = resA.b2ObjectKey,
            reservationId = resA.reservationId,
            jobId = jobA.jobId,
            storageRepository = fakeStorage
        )

        // Phone B finalizes second -> discovers Phone A's canonical hash -> safely deletes its redundant B2 object!
        val fileBId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileB,
            storedName = resB.storedName,
            b2ObjectKey = resB.b2ObjectKey,
            reservationId = resB.reservationId,
            jobId = jobB.jobId,
            storageRepository = fakeStorage
        )

        // Exactly 1 physical B2 object remains stored in the cloud
        assertEquals(1, fakeStorage.getStoredObjectCount())
        assertNotNull(fakeStorage.checkObjectExists(resA.b2ObjectKey))
        assertNull(fakeStorage.checkObjectExists(resB.b2ObjectKey))

        // Exactly 1 canonical content hash record exists
        assertEquals(1, fakeFirestore.contentHashes.size)
        val canonicalHashRecord = fakeFirestore.contentHashes["${vaultId}_$testSha"]
        assertNotNull(canonicalHashRecord)
        assertEquals(resA.b2ObjectKey, canonicalHashRecord!!["b2ObjectKey"])

        // Phone B's file document in Firestore points to canonical B2 key
        val fileBDoc = fakeFirestore.files["${vaultId}_$fileBId"]
        assertNotNull(fileBDoc)
        assertEquals(resA.b2ObjectKey, fileBDoc!!["b2ObjectKey"])

        // Retry idempotency: calling finalize again does not corrupt state or fail
        val retryId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileB,
            storedName = resB.storedName,
            b2ObjectKey = resB.b2ObjectKey,
            reservationId = resB.reservationId,
            jobId = jobB.jobId,
            storageRepository = fakeStorage
        )
        assertEquals(1, fakeStorage.getStoredObjectCount())
    }

    @Test
    fun testRedundantB2DeleteFailureRecordedInPendingDeletionStoreAndDrainedLaterWithoutCorruptingMetadata() = runBlocking {
        val fakeStorage = FakeCloudStorageRepository()
        val fakePendingDeletionStore = com.usbcloudbackup.cloud.storage.b2.FakePendingDeletionStore()
        val vaultId = "test_vault"
        val testSha = "4444444444444444444444444444444444444444444444444444444444444444"

        val sourceA = "src_phone_a"
        val sourceB = "src_phone_b"
        val jobA = BackupJob("job_a", sourceA, BackupJobState.UPLOADING, System.currentTimeMillis())
        val jobB = BackupJob("job_b", sourceB, BackupJobState.UPLOADING, System.currentTimeMillis())
        fakeFirestore.backupJobs["${vaultId}_${jobA.jobId}"] = jobA
        fakeFirestore.backupJobs["${vaultId}_${jobB.jobId}"] = jobB

        val resA = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceA,
            relativePath = "",
            originalName = "document.pdf",
            sha256 = testSha,
            jobId = jobA.jobId,
            ownerTaskId = "task_a"
        )
        val resB = fakeFirestore.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceB,
            relativePath = "",
            originalName = "document.pdf",
            sha256 = testSha,
            jobId = jobB.jobId,
            ownerTaskId = "task_b"
        )

        // Both upload bytes to B2
        fakeStorage.uploadFileStream(
            cloudObjectPath = resA.b2ObjectKey,
            inputStream = "content bytes".byteInputStream(),
            metadata = mapOf("x-custom-sha256" to testSha)
        )
        fakeStorage.uploadFileStream(
            cloudObjectPath = resB.b2ObjectKey,
            inputStream = "content bytes".byteInputStream(),
            metadata = mapOf("x-custom-sha256" to testSha)
        )

        val fileA = BackupFile(
            id = 201L,
            jobId = jobA.jobId,
            sourceId = sourceA,
            relativePath = "",
            originalName = "document.pdf",
            size = 13L,
            lastModified = 1000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )
        val fileB = BackupFile(
            id = 202L,
            jobId = jobB.jobId,
            sourceId = sourceB,
            relativePath = "",
            originalName = "document.pdf",
            size = 13L,
            lastModified = 1000L,
            sha256 = testSha,
            status = FileStatus.UPLOADING
        )

        // Phone A finalizes first -> establishes canonical hash
        val fileAId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileA,
            storedName = resA.storedName,
            b2ObjectKey = resA.b2ObjectKey,
            reservationId = resA.reservationId,
            jobId = jobA.jobId,
            storageRepository = fakeStorage,
            pendingDeletionStore = fakePendingDeletionStore
        )

        // Simulate network failure when Phone B attempts to delete redundant object
        fakeStorage.shouldFailDelete = true

        val fileBId = fakeFirestore.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileB,
            storedName = resB.storedName,
            b2ObjectKey = resB.b2ObjectKey,
            reservationId = resB.reservationId,
            jobId = jobB.jobId,
            storageRepository = fakeStorage,
            pendingDeletionStore = fakePendingDeletionStore
        )

        // 1. Metadata was NOT corrupted despite delete failure:
        // Canonical hash exists and points to Phone A's B2 object
        val canonicalHashRecord = fakeFirestore.contentHashes["${vaultId}_$testSha"]
        assertNotNull(canonicalHashRecord)
        assertEquals(resA.b2ObjectKey, canonicalHashRecord!!["b2ObjectKey"])

        // Phone B's file document correctly points to canonical B2 key
        val fileBDoc = fakeFirestore.files["${vaultId}_$fileBId"]
        assertNotNull(fileBDoc)
        assertEquals(resA.b2ObjectKey, fileBDoc!!["b2ObjectKey"])

        // 2. The redundant key was durably recorded in PendingDeletionStore
        assertEquals(setOf(resB.b2ObjectKey), fakePendingDeletionStore.getPendingDeletions())

        // 3. Later, storage network recovers and reconciliation or worker startup drains pending deletions
        fakeStorage.shouldFailDelete = false
        val pendingKeys = fakePendingDeletionStore.getPendingDeletions()
        for (key in pendingKeys) {
            val deleted = fakeStorage.deleteObject(key)
            if (deleted) {
                fakePendingDeletionStore.removePendingDeletion(key)
            }
        }

        // Store is now empty
        assertTrue(fakePendingDeletionStore.getPendingDeletions().isEmpty())

        // Redundant object is deleted from B2, leaving exactly 1 physical object
        assertEquals(1, fakeStorage.getStoredObjectCount())
        assertNotNull(fakeStorage.checkObjectExists(resA.b2ObjectKey))
        assertNull(fakeStorage.checkObjectExists(resB.b2ObjectKey))

        // Metadata still intact
        assertEquals(1, fakeFirestore.contentHashes.size)
    }
}
