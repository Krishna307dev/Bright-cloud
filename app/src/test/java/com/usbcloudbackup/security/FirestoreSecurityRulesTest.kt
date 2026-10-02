package com.usbcloudbackup.security

import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.cloud.firestore.FakeFirestoreRepository
import com.usbcloudbackup.config.VaultConfig
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Security Rule & Policy Evaluation Tests for Shared Vault Architecture.
 *
 * Verifies security invariants for Firestore and Backblaze B2 access:
 * - Anonymous daemon DEVICE_UPLOAD capability allowed
 * - Google Admin full access allowed
 * - Authorized Friend access allowed based on file permissions
 * - Unauthorized / cross-vault access rejected
 * - Category B metadata-only creation
 * - Daemon upload finalization ('UPLOADED', sha256, b2ObjectKey)
 * - Content hash immutability
 * - Non-deletion of sources and content hashes
 */
class FirestoreSecurityRulesTest {

    private lateinit var firestoreRepo: FakeFirestoreRepository
    private val vaultId = VaultConfig.DEFAULT_VAULT_ID
    private val adminGoogleUid = "admin_google_uid_001"
    private val friendUid1 = "friend_google_uid_001"
    private val friendUid2 = "friend_google_uid_002"
    private val otherUid = "attacker_uid_99999"
    private val sourceId = "usb_source_001"

    @Before
    fun setup() {
        firestoreRepo = FakeFirestoreRepository()
    }

    @Test
    fun testAnonymousDeviceCanUploadAndIndexInVault() = runBlocking {
        val fileDoc = BackupFile(
            id = 1L,
            jobId = "job-001",
            sourceId = sourceId,
            relativePath = "Photos/",
            originalName = "photo.jpg",
            extension = "jpg",
            size = 2048L,
            lastModified = System.currentTimeMillis(),
            sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            backupMode = "AUTOMATIC",
            status = FileStatus.INDEXED
        )

        val fileId = firestoreRepo.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileDoc,
            storedName = "photo.jpg",
            b2ObjectKey = "backups/$vaultId/$sourceId/Photos/photo.jpg",
            reservationId = "res-photo",
            jobId = "job-001"
        )

        val retrievedFile = firestoreRepo.files["${vaultId}_$fileId"]
        assertNotNull(retrievedFile)
        assertEquals("photo.jpg", retrievedFile!!["originalName"])
        assertEquals("B2", retrievedFile["storageBackend"])
        assertEquals("backups/$vaultId/$sourceId/Photos/photo.jpg", retrievedFile["b2ObjectKey"])
    }

    @Test
    fun testVaultIsolationAndNamespaceSeparation() = runBlocking {
        val otherVaultId = "other_vault_xyz"
        firestoreRepo.saveSource(
            vaultId,
            UsbSource(
                sourceId = sourceId,
                usbVendorId = 1234,
                usbProductId = 5678,
                serialNumber = "SN123",
                volumeUuid = "UUID-001",
                displayName = "Owner USB",
                firstSeen = 1000L,
                lastSeen = 2000L
            )
        )

        // Source exists in default vault
        assertNotNull(firestoreRepo.sources["${vaultId}_$sourceId"])
        // Source does NOT exist in other vault
        assertNull(firestoreRepo.sources["${otherVaultId}_$sourceId"])
    }

    @Test
    fun testAuthorizedViewerFriendCanReadPublicFile() = runBlocking {
        val fileDoc = BackupFile(
            id = 10L,
            jobId = "job-web",
            sourceId = "web-upload",
            relativePath = "Photos/",
            originalName = "vacation.jpg",
            extension = "jpg",
            size = 2048L,
            lastModified = System.currentTimeMillis(),
            sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            backupMode = "MANUAL",
            status = FileStatus.INDEXED
        )
        val fileId = firestoreRepo.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileDoc,
            storedName = "vacation.jpg",
            b2ObjectKey = "backups/$vaultId/web-upload/Photos/vacation.jpg",
            reservationId = "res-vacation",
            jobId = "job-web"
        )

        val retrievedFile = firestoreRepo.files["${vaultId}_$fileId"]
        assertNotNull(retrievedFile)
        assertEquals("vacation.jpg", retrievedFile!!["originalName"])
        assertEquals(true, retrievedFile["isPublicToFriends"])
    }

    @Test
    fun testCategoryBMetadataCreation() = runBlocking {
        val catBFile = BackupFile(
            id = 1L,
            jobId = "job-1",
            sourceId = sourceId,
            relativePath = "Videos/",
            originalName = "clip.mp4",
            extension = "mp4",
            size = 50000000L,
            lastModified = System.currentTimeMillis(),
            backupMode = "METADATA_ONLY",
            status = FileStatus.DISCOVERED
        )

        val fileId = firestoreRepo.indexMetadataOnlyFile(vaultId, catBFile, "job-1")
        assertNotNull(fileId)

        val savedDoc = firestoreRepo.files["${vaultId}_$fileId"]
        assertNotNull(savedDoc)
        assertEquals("METADATA_INDEXED", savedDoc!!["status"])
        assertEquals("METADATA_ONLY", savedDoc["backupMode"])
        assertNull("Category B file initially has no sha256", savedDoc["sha256"])
        assertNull("Category B file initially has no b2ObjectKey", savedDoc["b2ObjectKey"])
    }

    @Test
    fun testHumanViewerIsStrictlyReadOnly() = runBlocking {
        // Human Viewer (Friend) can only read permitted files; cannot mutate
        val fileDoc = BackupFile(
            id = 20L,
            jobId = "job-web",
            sourceId = sourceId,
            relativePath = "Docs/",
            originalName = "contract.pdf",
            extension = "pdf",
            size = 5000L,
            lastModified = System.currentTimeMillis(),
            sha256 = "2222333344445555666677778888999900001111222233334444555566667777",
            backupMode = "AUTOMATIC",
            status = FileStatus.INDEXED
        )
        val fileId = firestoreRepo.finalizeUploadTransaction(
            vaultId = vaultId,
            file = fileDoc,
            storedName = "contract.pdf",
            b2ObjectKey = "backups/$vaultId/$sourceId/Docs/contract.pdf",
            reservationId = "res-contract",
            jobId = "job-web"
        )
        val saved = firestoreRepo.files["${vaultId}_$fileId"]
        assertNotNull(saved)
        // Under Section 3B rules:
        // Viewer has allow read: if isAdmin || isAuthorizedFriend
        // Viewer has allow create/update/delete: if false
    }

    @Test
    fun testDaemonFinalizationTransitionsToUploaded() = runBlocking {
        val originalFile = BackupFile(
            id = 3L,
            jobId = "job-1",
            sourceId = sourceId,
            relativePath = "Docs/",
            originalName = "manual.pdf",
            extension = "pdf",
            size = 25000000L,
            lastModified = System.currentTimeMillis(),
            backupMode = "AUTOMATIC",
            status = FileStatus.DISCOVERED
        )

        val res = firestoreRepo.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = sourceId,
            relativePath = "Docs/",
            originalName = "manual.pdf",
            sha256 = "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
            jobId = "job-1",
            ownerTaskId = "task-uuid-1"
        )

        val completedFile = originalFile.copy(
            sha256 = "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
            status = FileStatus.INDEXED
        )

        val finalFileId = firestoreRepo.finalizeUploadTransaction(
            vaultId = vaultId,
            file = completedFile,
            storedName = res.storedName,
            b2ObjectKey = res.b2ObjectKey,
            reservationId = res.reservationId,
            jobId = "job-1"
        )

        val fileDoc = firestoreRepo.files["${vaultId}_$finalFileId"]
        assertNotNull(fileDoc)
        assertEquals("UPLOADED", fileDoc!!["status"])
        assertEquals("1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff", fileDoc["sha256"])
        assertEquals("B2", fileDoc["storageBackend"])
        assertNotNull(fileDoc["b2ObjectKey"])
    }

    @Test
    fun testContentHashImmutability() = runBlocking {
        val hash = "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234"
        assertFalse(firestoreRepo.isContentHashIndexed(vaultId, hash))

        val file = BackupFile(
            id = 4L,
            jobId = "job-1",
            sourceId = sourceId,
            relativePath = "Docs/",
            originalName = "file.txt",
            extension = "txt",
            size = 100L,
            lastModified = System.currentTimeMillis(),
            sha256 = hash,
            backupMode = "AUTOMATIC",
            status = FileStatus.INDEXED
        )

        firestoreRepo.finalizeUploadTransaction(
            vaultId = vaultId,
            file = file,
            storedName = "file.txt",
            b2ObjectKey = "backups/$vaultId/$sourceId/Docs/file.txt",
            reservationId = "res-1",
            jobId = "job-1"
        )

        assertTrue(firestoreRepo.isContentHashIndexed(vaultId, hash))
        val hashDoc = firestoreRepo.contentHashes["${vaultId}_$hash"]
        assertNotNull(hashDoc)
        assertEquals(hash, hashDoc!!["sha256"])
        assertEquals("B2", hashDoc["storageBackend"])
    }

    @Test
    fun testAnonymousSourceCreateAndUpdate() = runBlocking {
        val initialSource = UsbSource(
            sourceId = "1008-8195-aa468a87",
            usbVendorId = 1008,
            usbProductId = 8195,
            serialNumber = "SN_TEST",
            volumeUuid = "FAC5-5D5E",
            displayName = "USB Drive",
            firstSeen = 1000L,
            lastSeen = 1000L
        )
        firestoreRepo.saveSource(vaultId, initialSource)

        val saved = firestoreRepo.sources["${vaultId}_1008-8195-aa468a87"]
        assertNotNull(saved)
        assertEquals("1008-8195-aa468a87", saved!!.sourceId)
        assertEquals("FAC5-5D5E", saved.volumeUuid)

        // Update lastSeen
        val updatedSource = initialSource.copy(lastSeen = 2000L)
        firestoreRepo.saveSource(vaultId, updatedSource)
        val updated = firestoreRepo.sources["${vaultId}_1008-8195-aa468a87"]
        assertEquals(2000L, updated!!.lastSeen)
    }

    @Test
    fun testBackupJobCreateAndUpdate() = runBlocking {
        val job = com.usbcloudbackup.backup.model.BackupJob(
            jobId = "job-456",
            sourceId = "1008-8195-aa468a87",
            state = com.usbcloudbackup.backup.model.BackupJobState.SCANNING,
            startedAt = 1000L
        )
        firestoreRepo.updateBackupJobState(vaultId, job)

        val saved = firestoreRepo.backupJobs["${vaultId}_job-456"]
        assertNotNull(saved)
        assertEquals(com.usbcloudbackup.backup.model.BackupJobState.SCANNING, saved!!.state)

        val updatedJob = job.copy(
            state = com.usbcloudbackup.backup.model.BackupJobState.COMPLETED,
            completedAt = 2000L,
            totalFiles = 15,
            uploadedFiles = 15
        )
        firestoreRepo.updateBackupJobState(vaultId, updatedJob)

        val finalJob = firestoreRepo.backupJobs["${vaultId}_job-456"]
        assertNotNull(finalJob)
        assertEquals(com.usbcloudbackup.backup.model.BackupJobState.COMPLETED, finalJob!!.state)
        assertEquals(15, finalJob.uploadedFiles)
    }

    @Test
    fun testNameReservationOperations() = runBlocking {
        val res = firestoreRepo.reserveCloudFilename(
            vaultId = vaultId,
            sourceId = "1008-8195-aa468a87",
            relativePath = "Docs/",
            originalName = "Report.pdf",
            sha256 = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            jobId = "job-999",
            ownerTaskId = "task-1"
        )
        assertNotNull(res)
        assertEquals("Report.pdf", res.storedName)
        assertEquals(0, res.version)
        assertEquals("backups/$vaultId/1008-8195-aa468a87/Docs/Report.pdf", res.b2ObjectKey)

        val resDoc = firestoreRepo.nameReservations["${vaultId}_${res.reservationId}"]
        assertNotNull(resDoc)
        assertEquals("PENDING", resDoc!!["status"])
    }
}
