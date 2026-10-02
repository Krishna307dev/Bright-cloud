package com.usbcloudbackup.worker

import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.cloud.auth.AuthRepository
import com.usbcloudbackup.cloud.firestore.FirebaseFirestoreRepository
import com.usbcloudbackup.config.VaultConfig
import com.usbcloudbackup.receivers.UsbEventReceiver
import com.usbcloudbackup.setup.MainActivity
import com.usbcloudbackup.storage.SourceIdResolver
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import java.util.Date
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhysicalSourceAndWorkKeyRegressionTest {

    private lateinit var context: Context

    private val fakeAuth = object : AuthRepository {
        override fun getCurrentUid(): String = "anon_device_user_xyz"
        override fun isAuthenticated(): Boolean = true
        override suspend fun ensureAuthenticated(): String = "anon_device_user_xyz"
        override fun getAuthMethod(): String = "anonymous"
    }

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        SourceIdResolver.clearMappingsForTesting()

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()

        MainActivity.testAuthRepositoryOverride = fakeAuth
        MainActivity.testNotificationPermissionChecker = { true }
        MainActivity.testStoragePermissionChecker = { true }
        MainActivity.testHandoffTimeoutMs = 10L
        MainActivity.testMountWaitTimeoutMs = 100L
        MainActivity.testMountPollIntervalMs = 20L
    }

    @After
    fun tearDown() {
        SourceIdResolver.clearMappingsForTesting()
        SourceIdResolver.testStorageVolumesProvider = null
        SourceIdResolver.testMountedStorageDirectoriesProvider = null
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        MainActivity.testAuthRepositoryOverride = null
        MainActivity.testNotificationPermissionChecker = null
        MainActivity.testStoragePermissionChecker = null
        MainActivity.testHandoffTimeoutMs = 2500L
        MainActivity.testMountWaitTimeoutMs = 5000L
        MainActivity.testMountPollIntervalMs = 250L
    }

    /**
     * CONTRACT A:
     * Raw attach before filesystem mount and canonical handoff after mount for the SAME physical drive
     * resolve to the EXACT SAME uniqueWorkName ("backup_1008-8195-aa468a87").
     * ExistingWorkPolicy.REPLACE ensures WorkManager maintains only ONE unique work chain,
     * replacing the unmounted task rather than running two parallel BackupWorker instances.
     */
    @Test
    fun testContractA_rawAttachAndMountedHandoffShareSingleUniqueWorkChain() {
        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns null
            every { manufacturerName } returns "SanDisk"
            every { productName } returns "Ultra USB 3.0"
        }

        val rawHardwareId = SourceIdResolver.computeHardwareId(mockUsbDevice)
        val expectedWorkName = "backup_$rawHardwareId"

        // 1. Raw attach before filesystem mount (UsbEventReceiver)
        BackupWorkManager.enqueueBackup(context, rawHardwareId, mockUsbDevice)

        val workNameAfterAttach = BackupWorkManager.getUniqueWorkName(context, rawHardwareId, mockUsbDevice)
        assertEquals(expectedWorkName, workNameAfterAttach)

        val workInfosAttach = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(workNameAfterAttach)
            .get()
        assertEquals(1, workInfosAttach.size)

        // 2. Filesystem mounts 2 seconds later -> canonical sourceId resolved
        val canonicalSourceId = "1008-8195-0CF3-4237"
        BackupWorkManager.enqueueBackup(context, canonicalSourceId, mockUsbDevice)

        val workNameAfterMount = BackupWorkManager.getUniqueWorkName(context, canonicalSourceId, mockUsbDevice)
        assertEquals(expectedWorkName, workNameAfterMount)

        // Verify WorkManager maintains only one work chain under the exact same name
        val workInfosMount = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(expectedWorkName)
            .get()
        assertEquals(1, workInfosMount.size)

        // Verify there is NO separate work chain for canonical sourceId
        val separateCanonicalWork = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork("backup_1008-8195-0CF3-4237")
            .get()
        assertTrue("Must not create duplicate unique work under canonical sourceId", separateCanonicalWork.isEmpty())
    }

    /**
     * CONTRACT B:
     * Repeated attach of the same physical USB drive always resolves to the same stable workKey.
     */
    @Test
    fun testContractB_repeatedAttachProducesIdenticalUniqueWorkName() {
        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns null
            every { manufacturerName } returns "SanDisk"
            every { productName } returns "Ultra USB 3.0"
        }

        val expectedKey = SourceIdResolver.computeHardwareId(mockUsbDevice)
        val key1 = SourceIdResolver.resolveWorkKey(context, "1008-8195-0CF3-4237", mockUsbDevice)
        val key2 = SourceIdResolver.resolveWorkKey(context, "1008-8195-0CF3-4237", mockUsbDevice)
        val key3 = SourceIdResolver.resolveWorkKey(context, expectedKey, mockUsbDevice)

        assertEquals(expectedKey, key1)
        assertEquals(key1, key2)
        assertEquals(key1, key3)
    }

    /**
     * CONTRACT C:
     * USB disconnect cancels the backup, and reconnect re-enqueues under the same stable workKey.
     */
    @Test
    fun testContractC_disconnectCancelsAndReconnectResumesSameWorkKey() {
        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns null
            every { manufacturerName } returns "SanDisk"
            every { productName } returns "Ultra USB 3.0"
        }

        val expectedHwId = SourceIdResolver.computeHardwareId(mockUsbDevice)
        val expectedWorkName = "backup_$expectedHwId"

        // Attach
        BackupWorkManager.enqueueBackup(context, "1008-8195-0CF3-4237", mockUsbDevice)
        val workName = BackupWorkManager.getUniqueWorkName(context, "1008-8195-0CF3-4237", mockUsbDevice)
        assertEquals(expectedWorkName, workName)

        // Detach
        BackupWorkManager.cancelBackup(context, "1008-8195-0CF3-4237", mockUsbDevice)
        val workInfosAfterCancel = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(workName)
            .get()
        assertTrue(workInfosAfterCancel.any { it.state == WorkInfo.State.CANCELLED })

        // Reconnect
        BackupWorkManager.enqueueBackup(context, "1008-8195-0CF3-4237", mockUsbDevice)
        val workInfosAfterReconnect = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(workName)
            .get()
        assertFalse(workInfosAfterReconnect.isEmpty())
        assertEquals(expectedWorkName, workName)
    }

    /**
     * CONTRACT D:
     * Two different physical USB drives sharing the SAME VID and PID MUST NEVER collide or share a unique work name.
     * D1: Serial numbers distinguish the drives.
     * D2: When serial is unavailable, descriptor fingerprints distinguish the drives.
     */
    @Test
    fun testContractD1_sameVidPidDifferentSerialsProduceDistinctWorkKeys() {
        val driveA = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "SERIAL_ALPHA_001"
        }
        val driveB = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "SERIAL_BETA_002"
        }

        val workKeyA = SourceIdResolver.resolveWorkKey(context, "1008-8195-VOLA", driveA)
        val workKeyB = SourceIdResolver.resolveWorkKey(context, "1008-8195-VOLB", driveB)

        assertEquals("1008-8195-SERIAL_ALPHA_001", workKeyA)
        assertEquals("1008-8195-SERIAL_BETA_002", workKeyB)
        assertNotEquals(workKeyA, workKeyB)

        val workNameA = BackupWorkManager.getUniqueWorkName(context, "1008-8195-VOLA", driveA)
        val workNameB = BackupWorkManager.getUniqueWorkName(context, "1008-8195-VOLB", driveB)
        assertNotEquals(workNameA, workNameB)
    }

    @Test
    fun testContractD2_sameVidPidDifferentDescriptorsProduceDistinctWorkKeys() {
        val driveA = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns null
            every { manufacturerName } returns "VendorX"
            every { productName } returns "DriveModelA"
        }
        val driveB = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns null
            every { manufacturerName } returns "VendorX"
            every { productName } returns "DriveModelB"
        }

        val workKeyA = SourceIdResolver.resolveWorkKey(context, "1008-8195-VOLA", driveA)
        val workKeyB = SourceIdResolver.resolveWorkKey(context, "1008-8195-VOLB", driveB)

        assertNotEquals(workKeyA, workKeyB)
        assertFalse(workKeyA.contains("VOLA"))
        assertFalse(workKeyB.contains("VOLB"))
    }

    /**
     * CONTRACT E:
     * Physical hardware identity rules:
     * 1. USB serial number is the strongest identity and is used when available.
     * 2. Descriptor hash fallback is a best-effort fingerprint used when serial is absent.
     * 3. VID+PID alone is NEVER used as the work key.
     */
    @Test
    fun testContractE_hardwareIdentityHierarchyAndSafety() {
        val deviceWithSerial = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1234
            every { productId } returns 5678
            every { serialNumber } returns "SN_STRONG_123"
            every { manufacturerName } returns "Vendor"
            every { productName } returns "Model"
        }
        val hwIdWithSerial = SourceIdResolver.computeHardwareId(deviceWithSerial)
        assertEquals("1234-5678-SN_STRONG_123", hwIdWithSerial)

        val deviceWithoutSerial = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1234
            every { productId } returns 5678
            every { serialNumber } returns null
            every { manufacturerName } returns "Vendor"
            every { productName } returns "Model"
        }
        val hwIdWithoutSerial = SourceIdResolver.computeHardwareId(deviceWithoutSerial)
        assertFalse(hwIdWithoutSerial.contains("null"))
        assertNotEquals("1234-5678", hwIdWithoutSerial)
        assertTrue(hwIdWithoutSerial.startsWith("1234-5678-"))
        assertEquals(18, hwIdWithoutSerial.length) // "1234-5678-" (10 chars) + 8-char hash = 18 chars
    }

    /**
     * CONTRACT F:
     * Canonical sourceId format ({vid}-{pid}-{volumeUuid}) is strictly preserved throughout the pipeline.
     */
    @Test
    fun testContractF_canonicalSourceIdPreserved() {
        val canonicalSourceId = "1008-8195-0CF3-4237"
        val canonicalized = SourceIdResolver.canonicalizeSourceId(context, canonicalSourceId)
        assertEquals("1008-8195-0CF3-4237", canonicalized)

        val parsed = SourceIdResolver.parseSourceComponents(canonicalSourceId, context)
        assertEquals(1008, parsed.vendorId)
        assertEquals(8195, parsed.productId)
        assertEquals("0CF3-4237", parsed.volumeUuid)
    }

    /**
     * CONTRACT G:
     * Zero Firebase Anonymous UID leakage into canonical sourceId or WorkManager unique work key.
     */
    @Test
    fun testContractG_zeroAnonymousUidLeakage() {
        val anonUid = fakeAuth.getCurrentUid()
        val mockUsbDevice = mockk<UsbDevice>(relaxed = true) {
            every { vendorId } returns 1008
            every { productId } returns 8195
            every { serialNumber } returns "SN_DEVICE_01"
        }

        val canonicalSourceId = "1008-8195-0CF3-4237"
        val workKey = SourceIdResolver.resolveWorkKey(context, canonicalSourceId, mockUsbDevice)
        val uniqueWorkName = BackupWorkManager.getUniqueWorkName(context, canonicalSourceId, mockUsbDevice)

        assertFalse("Canonical sourceId must not contain Anonymous UID", canonicalSourceId.contains(anonUid))
        assertFalse("WorkKey must not contain Anonymous UID", workKey.contains(anonUid))
        assertFalse("UniqueWorkName must not contain Anonymous UID", uniqueWorkName.contains(anonUid))
    }

    /**
     * CONTRACT H:
     * Firestore source update / create separation:
     * - When updating an existing source document, repository calls update() on mutable fields only
     *   (lastSeen, displayName) and does NOT overwrite immutable firstSeen or volumeUuid.
     * - When source does not exist (NOT_FOUND), repository calls set() to create it.
     */
    @Test
    fun testContractH_firestoreSourceUpdateAndCreateSeparation() = runBlocking {
        val mockFirestore = mockk<FirebaseFirestore>()
        val mockDocRef = mockk<DocumentReference>()
        val vaultId = VaultConfig.DEFAULT_VAULT_ID
        val sourceId = "1008-8195-0CF3-4237"

        every {
            mockFirestore.collection("vaults").document(vaultId)
                .collection("sources").document(sourceId)
        } returns mockDocRef

        val updateSlot = slot<Map<String, Any>>()
        every { mockDocRef.update(capture(updateSlot)) } returns com.google.android.gms.tasks.Tasks.forResult(null)

        val repo = FirebaseFirestoreRepository(mockFirestore)
        val source = UsbSource(
            sourceId = sourceId,
            usbVendorId = 1008,
            usbProductId = 8195,
            serialNumber = null,
            volumeUuid = "0CF3-4237",
            displayName = "USB Drive",
            firstSeen = 1773000000000L,
            lastSeen = 1773500000000L
        )

        // Case 1: Existing document -> update is called without firstSeen
        repo.saveSource(vaultId, source)

        assertTrue(updateSlot.isCaptured)
        val capturedMap = updateSlot.captured
        assertFalse("Update must NOT include immutable firstSeen", capturedMap.containsKey("firstSeen"))
        assertTrue("Update must include mutable lastSeen", capturedMap.containsKey("lastSeen"))
        assertTrue("Update must include mutable displayName", capturedMap.containsKey("displayName"))
        assertEquals("USB Drive", capturedMap["displayName"])

        // Case 2: Document NOT_FOUND -> set() is called to create document with all fields
        val notFoundEx = FirebaseFirestoreException("Document not found", FirebaseFirestoreException.Code.NOT_FOUND)
        every { mockDocRef.update(any<Map<String, Any>>()) } returns com.google.android.gms.tasks.Tasks.forException(notFoundEx)

        val setSlot = slot<Map<String, Any?>>()
        every { mockDocRef.set(capture(setSlot)) } returns com.google.android.gms.tasks.Tasks.forResult(null)

        repo.saveSource(vaultId, source)

        assertTrue(setSlot.isCaptured)
        val createdMap = setSlot.captured
        assertTrue("Create must include firstSeen", createdMap.containsKey("firstSeen"))
        assertTrue("Create must include volumeUuid", createdMap.containsKey("volumeUuid"))
        assertEquals("0CF3-4237", createdMap["volumeUuid"])
        assertEquals(sourceId, createdMap["sourceId"])
    }
}
