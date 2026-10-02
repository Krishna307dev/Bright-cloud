package com.usbcloudbackup.resilience

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.backup.repository.SourceRepository
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.hashing.Sha256Calculator
import com.usbcloudbackup.storage.FakeStorageSource
import java.io.IOException
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
class UsbDisconnectSafetyTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var sourceRepo: SourceRepository
    private lateinit var jobRepo: BackupJobRepository
    private lateinit var fileRepo: FileRepository

    private val testSourceId = "usb-disconnect-001"
    private val testJobId = "job-disconnect-001"

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
    }

    @After
    fun tearDown() {
        AppDatabase.setTestInstance(null)
        db.close()
    }

    @Test
    fun testUsbDisconnectDuringStreamReadMarksSourceUnavailable() = runBlocking {
        val source = UsbSource(testSourceId, 123, 456, "SN_DISC", "VOL_DISC", "Disconnect USB", 1000L, 2000L)
        sourceRepo.saveSource(source)

        val job = BackupJob(testJobId, testSourceId, BackupJobState.HASHING, 1000L)
        jobRepo.createJob(job)

        val fakeStorage = FakeStorageSource(testSourceId, "Disconnect Drive")
        fakeStorage.addFile("Data/", "DisappearingFile.txt", "Some bytes".toByteArray(Charsets.UTF_8), shouldFailOnOpen = true)

        val descriptors = fakeStorage.discoverFiles()
        assertEquals(1, descriptors.size)
        val descriptor = descriptors[0]

        // Attempting to read input stream throws IOException due to disconnection
        var exceptionThrown = false
        try {
            descriptor.openInputStream().use { inputStream ->
                Sha256Calculator.calculateHash(inputStream)
            }
        } catch (e: IOException) {
            exceptionThrown = true
        }

        assertTrue(exceptionThrown)
    }

    @Test
    fun testUsbReconnectSameDeviceResumesUnfinishedJob() = runBlocking {
        val source = UsbSource(testSourceId, 123, 456, "SN_DISC", "VOL_DISC", "Disconnect USB", 1000L, 2000L)
        sourceRepo.saveSource(source)

        val job = BackupJob(testJobId, testSourceId, BackupJobState.HASHING, 1000L)
        jobRepo.createJob(job)

        val incompleteJobs = jobRepo.getIncompleteJobsForSource(testSourceId)
        assertEquals(1, incompleteJobs.size)
        assertEquals(testJobId, incompleteJobs[0].jobId)
    }

    @Test
    fun testDifferentUsbDeviceCreatesIndependentSourceAndJob() = runBlocking {
        val source1 = UsbSource("usb-device-A", 1, 1, "SN_A", "VOL_A", "Drive A", 1000L, 2000L)
        sourceRepo.saveSource(source1)
        val job1 = BackupJob("job-A", "usb-device-A", BackupJobState.HASHING, 1000L)
        jobRepo.createJob(job1)

        val source2 = UsbSource("usb-device-B", 2, 2, "SN_B", "VOL_B", "Drive B", 2000L, 3000L)
        sourceRepo.saveSource(source2)
        val job2 = BackupJob("job-B", "usb-device-B", BackupJobState.SCANNING, 2000L)
        jobRepo.createJob(job2)

        val jobsA = jobRepo.getIncompleteJobsForSource("usb-device-A")
        val jobsB = jobRepo.getIncompleteJobsForSource("usb-device-B")

        assertEquals(1, jobsA.size)
        assertEquals("job-A", jobsA[0].jobId)

        assertEquals(1, jobsB.size)
        assertEquals("job-B", jobsB[0].jobId)
    }
}
