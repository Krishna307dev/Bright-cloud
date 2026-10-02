package com.usbcloudbackup.backup.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StateMachineTest {

    @Test
    fun testBackupJobStateValidTransitions() {
        assertTrue(BackupJobState.SCANNING.canTransitionTo(BackupJobState.HASHING))
        assertTrue(BackupJobState.HASHING.canTransitionTo(BackupJobState.DEDUPLICATING))
        assertTrue(BackupJobState.DEDUPLICATING.canTransitionTo(BackupJobState.UPLOADING))
        assertTrue(BackupJobState.UPLOADING.canTransitionTo(BackupJobState.COMPLETED))

        assertEquals(BackupJobState.HASHING, BackupJobState.SCANNING.transitionTo(BackupJobState.HASHING))
    }

    @Test(expected = IllegalStateException::class)
    fun testBackupJobStateInvalidTransitionThrows() {
        BackupJobState.SCANNING.transitionTo(BackupJobState.COMPLETED)
    }

    @Test
    fun testFileStatusValidTransitions() {
        assertTrue(FileStatus.DISCOVERED.canTransitionTo(FileStatus.HASHING))
        assertTrue(FileStatus.HASHING.canTransitionTo(FileStatus.HASHED))
        assertTrue(FileStatus.HASHED.canTransitionTo(FileStatus.SKIPPED_DUPLICATE))
        assertTrue(FileStatus.HASHED.canTransitionTo(FileStatus.NAME_RESERVING))
        assertTrue(FileStatus.NAME_RESERVING.canTransitionTo(FileStatus.NAME_RESERVED))
        assertTrue(FileStatus.NAME_RESERVED.canTransitionTo(FileStatus.UPLOADING))
        assertTrue(FileStatus.UPLOADING.canTransitionTo(FileStatus.UPLOADED_NOT_INDEXED))
        assertTrue(FileStatus.UPLOADED_NOT_INDEXED.canTransitionTo(FileStatus.INDEXED))

        assertEquals(FileStatus.HASHING, FileStatus.DISCOVERED.transitionTo(FileStatus.HASHING))
    }

    @Test(expected = IllegalStateException::class)
    fun testFileStatusInvalidTransitionFromDiscoveredToUploaded() {
        FileStatus.DISCOVERED.transitionTo(FileStatus.INDEXED)
    }

    @Test(expected = IllegalStateException::class)
    fun testFileStatusInvalidTransitionFromIndexed() {
        FileStatus.INDEXED.transitionTo(FileStatus.UPLOADING)
    }

    @Test
    fun testFileStatusSourceUnavailableRecovery() {
        assertTrue(FileStatus.DISCOVERED.canTransitionTo(FileStatus.SOURCE_UNAVAILABLE))
        assertTrue(FileStatus.UPLOADING.canTransitionTo(FileStatus.SOURCE_UNAVAILABLE))
        assertTrue(FileStatus.SOURCE_UNAVAILABLE.canTransitionTo(FileStatus.UPLOADING))
    }

    @Test
    fun testUploadTaskStateTransitions() {
        assertTrue(UploadTaskState.RESERVING.canTransitionTo(UploadTaskState.RESERVED))
        assertTrue(UploadTaskState.RESERVED.canTransitionTo(UploadTaskState.UPLOADING))
        assertTrue(UploadTaskState.UPLOADING.canTransitionTo(UploadTaskState.UPLOADED_NOT_INDEXED))
        assertTrue(UploadTaskState.UPLOADED_NOT_INDEXED.canTransitionTo(UploadTaskState.INDEXED))
        assertTrue(UploadTaskState.UPLOADING.canTransitionTo(UploadTaskState.FAILED))
        assertTrue(UploadTaskState.FAILED.canTransitionTo(UploadTaskState.UPLOADING))
    }

    @Test(expected = IllegalStateException::class)
    fun testUploadTaskStateInvalidTransitionFromReservingToIndexed() {
        UploadTaskState.RESERVING.transitionTo(UploadTaskState.INDEXED)
    }

    @Test
    fun testReservationStatusTransitions() {
        assertTrue(ReservationStatus.PENDING.canTransitionTo(ReservationStatus.COMMITTED))
        assertTrue(ReservationStatus.PENDING.canTransitionTo(ReservationStatus.EXPIRED))
        assertTrue(ReservationStatus.EXPIRED.canTransitionTo(ReservationStatus.PENDING))
        assertFalse(ReservationStatus.COMMITTED.canTransitionTo(ReservationStatus.PENDING))
    }
}
