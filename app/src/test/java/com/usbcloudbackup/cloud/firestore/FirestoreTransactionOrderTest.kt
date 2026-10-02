package com.usbcloudbackup.cloud.firestore

import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Transaction
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.FileStatus
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FirestoreTransactionOrderTest {

    @Test
    fun testFinalizeUploadTransactionExecutesAllReadsBeforeAllWrites() = runBlocking {
        val firestore = mockk<FirebaseFirestore>()
        val vaultDoc = mockk<DocumentReference>()
        val filesCol = mockk<CollectionReference>()
        val fileDoc = mockk<DocumentReference>()
        val hashesCol = mockk<CollectionReference>()
        val hashDoc = mockk<DocumentReference>()
        val hashSnapshot = mockk<DocumentSnapshot>()
        val resCol = mockk<CollectionReference>()
        val resDoc = mockk<DocumentReference>()
        val jobsCol = mockk<CollectionReference>()
        val jobDoc = mockk<DocumentReference>()

        every { firestore.collection("vaults").document("default") } returns vaultDoc
        every { vaultDoc.collection("files") } returns filesCol
        every { filesCol.document() } returns fileDoc
        every { filesCol.document(any()) } returns fileDoc
        every { fileDoc.id } returns "generated-file-id-123"

        every { vaultDoc.collection("contentHashes") } returns hashesCol
        every { hashesCol.document(any()) } returns hashDoc

        every { vaultDoc.collection("nameReservations") } returns resCol
        every { resCol.document(any()) } returns resDoc

        every { vaultDoc.collection("backupJobs") } returns jobsCol
        every { jobsCol.document(any()) } returns jobDoc

        every { hashSnapshot.exists() } returns false

        val txSlot = slot<Transaction.Function<Any>>()
        val txMock = mockk<Transaction>()

        val opsLog = mutableListOf<String>()
        var writeEncountered = false

        every { txMock.get(hashDoc) } answers {
            if (writeEncountered) {
                throw FirebaseFirestoreException(
                    "Firestore transactions require all reads to be executed before all writes.",
                    FirebaseFirestoreException.Code.INVALID_ARGUMENT
                )
            }
            opsLog.add("READ")
            hashSnapshot
        }

        every { txMock.set(any(), any<Map<String, Any?>>()) } answers {
            writeEncountered = true
            opsLog.add("WRITE_SET")
            txMock
        }

        every { txMock.update(any(), any<String>(), any()) } answers {
            writeEncountered = true
            opsLog.add("WRITE_UPDATE")
            txMock
        }

        every { firestore.runTransaction(capture(txSlot)) } answers {
            val result = txSlot.captured.apply(txMock)
            Tasks.forResult(result)
        }

        val repo = FirebaseFirestoreRepository(firestore)

        val backupFile = BackupFile(
            id = 100L,
            jobId = "job-001",
            sourceId = "1008-8195-FAC5-5D5E",
            relativePath = "Docs/",
            originalName = "CHAPTER 5.pdf",
            extension = "pdf",
            size = 5000L,
            lastModified = System.currentTimeMillis(),
            sha256 = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            backupMode = "AUTOMATIC",
            status = FileStatus.UPLOADED_NOT_INDEXED
        )

        val generatedId = repo.finalizeUploadTransaction(
            vaultId = "default",
            file = backupFile,
            storedName = "CHAPTER 5.pdf",
            b2ObjectKey = "backups/default/1008-8195-FAC5-5D5E/Docs/CHAPTER 5.pdf",
            reservationId = "res-001",
            jobId = "job-001"
        )

        assertEquals("generated-file-id-123", generatedId)

        // Verify transaction invariant: all READs precede all WRITEs
        assertTrue("Operations log must contain operations", opsLog.isNotEmpty())
        assertEquals("READ", opsLog.first())

        val firstWriteIndex = opsLog.indexOfFirst { it.startsWith("WRITE") }
        val lastReadIndex = opsLog.indexOfLast { it == "READ" }

        assertTrue("At least one read must have occurred", lastReadIndex >= 0)
        assertTrue("At least one write must have occurred", firstWriteIndex >= 0)
        assertTrue(
            "All reads must execute strictly before any writes. Last read: $lastReadIndex, First write: $firstWriteIndex",
            lastReadIndex < firstWriteIndex
        )
    }

    @Test
    fun testTransactionSimulationFailsIfReadFollowsWrite() {
        val txMock = mockk<Transaction>()
        var writeEncountered = false
        val docMock = mockk<DocumentReference>()

        every { txMock.set(any(), any<Map<String, Any?>>()) } answers {
            writeEncountered = true
            txMock
        }

        every { txMock.get(docMock) } answers {
            if (writeEncountered) {
                throw FirebaseFirestoreException(
                    "Firestore transactions require all reads to be executed before all writes.",
                    FirebaseFirestoreException.Code.INVALID_ARGUMENT
                )
            }
            mockk<DocumentSnapshot>()
        }

        // Perform write then read
        txMock.set(docMock, mapOf("k" to "v"))
        try {
            txMock.get(docMock)
            fail("Expected FirebaseFirestoreException when reading after writing")
        } catch (e: FirebaseFirestoreException) {
            assertTrue(e.message!!.contains("Firestore transactions require all reads to be executed before all writes"))
        }
    }
}
