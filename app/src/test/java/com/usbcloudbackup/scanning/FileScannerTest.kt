package com.usbcloudbackup.scanning

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.BackupJobState
import com.usbcloudbackup.backup.model.FileStatus
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.backup.repository.BackupJobRepository
import com.usbcloudbackup.backup.repository.FileRepository
import com.usbcloudbackup.database.AppDatabase
import com.usbcloudbackup.storage.DirectFileStorageSource
import com.usbcloudbackup.storage.FakeStorageSource
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FileScannerTest {

    private lateinit var db: AppDatabase
    private lateinit var fileRepository: FileRepository
    private lateinit var jobRepository: BackupJobRepository
    private lateinit var scanner: FileScanner

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        fileRepository = FileRepository(db.fileDao())
        jobRepository = BackupJobRepository(db.backupJobDao())
        scanner = FileScanner(fileRepository, jobRepository)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun testEmptyDirectoryDiscovery() {
        runBlocking {
            val fakeSource = FakeStorageSource("src1", "Empty Drive")
            val sourceEntity = UsbSource("src1", 1, 2, "SN", null, "Drive", 1L, 1L)
            db.sourceDao().insertSource(sourceEntity.toEntity())
            val job = BackupJob("job1", "src1", BackupJobState.SCANNING, 100L)
            jobRepository.createJob(job)

            val files = scanner.scanSource("job1", fakeSource)
            assertTrue(files.isEmpty())

            val updatedJob = jobRepository.getJob("job1")
            assertEquals(0, updatedJob?.totalFiles)
        }
    }

    @Test
    fun testNestedDirectoriesAndUnicodeFilenames() {
        runBlocking {
            val fakeSource = FakeStorageSource("src2", "USB Drive")
            fakeSource.addFile("Notes/Math/", "Chapter1.pdf", "math content".toByteArray())
            fakeSource.addFile("Notes/Science/", "Physics.docx", "physics content".toByteArray())
            fakeSource.addFile("नोट्स/", "पाठ1.pdf", "hindi content".toByteArray())
            fakeSource.addFile("", "README.txt", "readme".toByteArray())

            val sourceEntity = UsbSource("src2", 1, 2, "SN", null, "Drive", 1L, 1L)
            db.sourceDao().insertSource(sourceEntity.toEntity())
            val job = BackupJob("job2", "src2", BackupJobState.SCANNING, 100L)
            jobRepository.createJob(job)

            val files = scanner.scanSource("job2", fakeSource)
            assertEquals(4, files.size)

            val mathFile = files.find { it.originalName == "Chapter1.pdf" }
            assertNotNull(mathFile)
            assertEquals("Notes/Math/", mathFile?.relativePath)
            assertEquals(FileStatus.DISCOVERED, mathFile?.status)

            val hindiFile = files.find { it.originalName == "पाठ1.pdf" }
            assertNotNull(hindiFile)
            assertEquals("नोट्स/", hindiFile?.relativePath)

            val rootFile = files.find { it.originalName == "README.txt" }
            assertNotNull(rootFile)
            assertEquals("", rootFile?.relativePath)

            val updatedJob = jobRepository.getJob("job2")
            assertEquals(4, updatedJob?.totalFiles)
        }
    }

    @Test
    fun testDirectFileStorageSourceRecursiveScan() {
        runBlocking {
            val tempDir = File(System.getProperty("java.io.tmpdir"), "usb_test_root_${System.currentTimeMillis()}")
            tempDir.mkdirs()
            tempDir.deleteOnExit()

            val subDir = File(tempDir, "Documents/Work")
            subDir.mkdirs()

            val file1 = File(tempDir, "RootFile.txt")
            FileOutputStream(file1).use { it.write("root file content".toByteArray()) }

            val file2 = File(subDir, "Report 2026.pdf")
            FileOutputStream(file2).use { it.write("report content".toByteArray()) }

            val directSource = DirectFileStorageSource("src3", "Direct USB Drive", tempDir)
            val sourceEntity = UsbSource("src3", 1, 2, "SN", null, "Drive", 1L, 1L)
            db.sourceDao().insertSource(sourceEntity.toEntity())
            val job = BackupJob("job3", "src3", BackupJobState.SCANNING, 100L)
            jobRepository.createJob(job)

            val files = scanner.scanSource("job3", directSource)
            assertEquals(2, files.size)

            val pdf = files.find { it.originalName == "Report 2026.pdf" }
            assertNotNull(pdf)
            assertEquals("Documents/Work/", pdf?.relativePath)

            // Cleanup
            file1.delete()
            file2.delete()
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun testUniversalFileEligibilityAndExclusions() {
        runBlocking {
            val fakeSource = FakeStorageSource("src5", "Universal USB Drive")
            // Regular user files (all should be AUTOMATIC)
            fakeSource.addFile("Videos/", "holiday.mp4", "mp4 bytes".toByteArray())
            fakeSource.addFile("Music/", "track.mp3", "mp3 bytes".toByteArray())
            fakeSource.addFile("Backups/", "project.zip", "zip bytes".toByteArray())
            fakeSource.addFile("Apps/", "tool.apk", "apk bytes".toByteArray())
            fakeSource.addFile("Custom/", "dataset.unknownext", "custom bytes".toByteArray())
            fakeSource.addFile("", "README", "readme bytes".toByteArray())

            // Nested Android directory (user created - should be INCLUDED)
            fakeSource.addFile("Projects/Android/", "MainActivity.kt", "code".toByteArray())

            // Excluded system files (should be EXCLUDED)
            fakeSource.addFile("", ".DS_Store", "ds store".toByteArray())
            fakeSource.addFile("", ".database_uuid", "root db uuid".toByteArray())
            fakeSource.addFile("Videos/", "Thumbs.db", "thumbs".toByteArray())
            fakeSource.addFile("Videos/", "desktop.ini", "ini".toByteArray())
            fakeSource.addFile("Videos/", "._holiday.mp4", "apple double".toByteArray())
            fakeSource.addFile("Videos/", ".database_uuid", "nested db uuid".toByteArray())
            fakeSource.addFile("Documents/", "~\$notes.docx", "temp lock".toByteArray())
            fakeSource.addFile("Documents/", ".DATABASE_UUID", "deep case-insensitive db uuid".toByteArray())
            fakeSource.addFile("Images/", ".nomedia", "".toByteArray())
            fakeSource.addFile("Documents/", "database_uuid.txt", "valid doc".toByteArray())

            // Excluded system directories (should be EXCLUDED)
            fakeSource.addFile("LOST.DIR/", "recovered.bin", "lost".toByteArray())
            fakeSource.addFile("System Volume Information/", "tracking.log", "win".toByteArray())
            fakeSource.addFile("\$RECYCLE.BIN/", "trashed.exe", "bin".toByteArray())
            fakeSource.addFile("Android/data/com.app/", "cache.dat", "android cache".toByteArray())

            val sourceEntity = UsbSource("src5", 1, 2, "SN", null, "Drive", 1L, 1L)
            db.sourceDao().insertSource(sourceEntity.toEntity())
            val job = BackupJob("job5", "src5", BackupJobState.SCANNING, 100L)
            jobRepository.createJob(job)

            val files = scanner.scanSource("job5", fakeSource)

            // Should contain exactly the 8 regular user files (7 original + database_uuid.txt)
            assertEquals(8, files.size)

            val expectedFiles = mapOf(
                "holiday.mp4" to "Videos/",
                "track.mp3" to "Music/",
                "project.zip" to "Backups/",
                "tool.apk" to "Apps/",
                "dataset.unknownext" to "Custom/",
                "README" to "",
                "MainActivity.kt" to "Projects/Android/",
                "database_uuid.txt" to "Documents/"
            )

            for ((expectedName, expectedPath) in expectedFiles) {
                val file = files.find { it.originalName == expectedName }
                assertNotNull("File $expectedName should be discovered", file)
                assertEquals(expectedPath, file?.relativePath)
                assertEquals("AUTOMATIC", file?.backupMode)
                assertEquals(FileStatus.DISCOVERED, file?.status)
            }

            // Verify none of the excluded files/directories are present
            val excludedNames = setOf(
                ".DS_Store", "Thumbs.db", "desktop.ini", "._holiday.mp4",
                "~\$notes.docx", ".nomedia", "recovered.bin", "tracking.log",
                "trashed.exe", "cache.dat", ".database_uuid", ".DATABASE_UUID"
            )
            for (file in files) {
                assertTrue("File ${file.originalName} should NOT be in discovered files", file.originalName !in excludedNames)
            }
        }
    }

    @Test
    fun testDirectFileStorageSourceExclusionsAndUnreadableFiles() {
        runBlocking {
            val tempDir = File(System.getProperty("java.io.tmpdir"), "usb_direct_test_${System.currentTimeMillis()}")
            tempDir.mkdirs()
            tempDir.deleteOnExit()

            // Normal folders and files
            val videosDir = File(tempDir, "Videos")
            videosDir.mkdirs()
            val mp4File = File(videosDir, "clip.mp4")
            FileOutputStream(mp4File).use { it.write("video content".toByteArray()) }

            val nestedAndroid = File(tempDir, "Projects/Android")
            nestedAndroid.mkdirs()
            val kotlinFile = File(nestedAndroid, "App.kt")
            FileOutputStream(kotlinFile).use { it.write("kotlin content".toByteArray()) }

            // Excluded system directories
            val lostDir = File(tempDir, "LOST.DIR")
            lostDir.mkdirs()
            val lostFile = File(lostDir, "found001.bin")
            FileOutputStream(lostFile).use { it.write("lost data".toByteArray()) }

            val rootAndroidDir = File(tempDir, "Android")
            rootAndroidDir.mkdirs()
            val cacheFile = File(rootAndroidDir, "cache.tmp")
            FileOutputStream(cacheFile).use { it.write("cache data".toByteArray()) }

            // Excluded system files
            val dsStore = File(tempDir, ".DS_Store")
            FileOutputStream(dsStore).use { it.write("ds_store".toByteArray()) }

            val thumbsDb = File(videosDir, "Thumbs.db")
            FileOutputStream(thumbsDb).use { it.write("thumbs".toByteArray()) }

            val appleDouble = File(videosDir, "._clip.mp4")
            FileOutputStream(appleDouble).use { it.write("apple double".toByteArray()) }

            val rootDbUuid = File(tempDir, ".database_uuid")
            FileOutputStream(rootDbUuid).use { it.write("root uuid".toByteArray()) }

            val nestedDbUuid = File(videosDir, ".DATABASE_UUID")
            FileOutputStream(nestedDbUuid).use { it.write("nested uuid".toByteArray()) }

            // Unreadable file
            val unreadableFile = File(tempDir, "Unreadable.secret")
            FileOutputStream(unreadableFile).use { it.write("secret".toByteArray()) }
            unreadableFile.setReadable(false)

            val directSource = DirectFileStorageSource("src6", "Direct USB", tempDir)
            val sourceEntity = UsbSource("src6", 1, 2, "SN", null, "Drive", 1L, 1L)
            db.sourceDao().insertSource(sourceEntity.toEntity())
            val job = BackupJob("job6", "src6", BackupJobState.SCANNING, 100L)
            jobRepository.createJob(job)

            val files = scanner.scanSource("job6", directSource)

            // Should discover clip.mp4 and Projects/Android/App.kt
            val mp4 = files.find { it.originalName == "clip.mp4" }
            assertNotNull("clip.mp4 should be discovered", mp4)
            assertEquals("Videos/", mp4?.relativePath)
            assertEquals("AUTOMATIC", mp4?.backupMode)

            val kt = files.find { it.originalName == "App.kt" }
            assertNotNull("App.kt in Projects/Android should be discovered", kt)
            assertEquals("Projects/Android/", kt?.relativePath)
            assertEquals("AUTOMATIC", kt?.backupMode)

            // Verify excluded files are NOT discovered
            val discoveredNames = files.map { it.originalName }
            assertTrue(".DS_Store must be excluded", ".DS_Store" !in discoveredNames)
            assertTrue("Thumbs.db must be excluded", "Thumbs.db" !in discoveredNames)
            assertTrue("._clip.mp4 must be excluded", "._clip.mp4" !in discoveredNames)
            assertTrue("found001.bin must be excluded", "found001.bin" !in discoveredNames)
            assertTrue("cache.tmp must be excluded", "cache.tmp" !in discoveredNames)
            assertTrue(".database_uuid at root must be excluded", ".database_uuid" !in discoveredNames)
            assertTrue(".DATABASE_UUID in nested folder must be excluded", ".DATABASE_UUID" !in discoveredNames)

            // Cleanup
            unreadableFile.setReadable(true)
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun testDatabaseUuidExcludedAtAllDepths() {
        runBlocking {
            val fakeSource = FakeStorageSource("src_uuid_test", "USB with database_uuid")

            // .database_uuid at various directory depths and case variations (all must be EXCLUDED)
            fakeSource.addFile("", ".database_uuid", "root uuid".toByteArray())
            fakeSource.addFile("Notes/", ".database_uuid", "level 1 uuid".toByteArray())
            fakeSource.addFile("Level1/Level2/", ".database_uuid", "level 2 uuid".toByteArray())
            fakeSource.addFile("Level1/Level2/Level3/", ".DATABASE_UUID", "level 3 uppercase uuid".toByteArray())
            fakeSource.addFile("Level1/Level2/Level3/Level4/", ".Database_Uuid", "level 4 mixed case uuid".toByteArray())

            // Legitimate user files with similar names (all must be DISCOVERED)
            fakeSource.addFile("", "database_uuid.txt", "text doc".toByteArray())
            fakeSource.addFile("Notes/", "database_uuid.pdf", "pdf doc".toByteArray())
            fakeSource.addFile("Data/", "database.sqlite", "sqlite db".toByteArray())
            fakeSource.addFile("Deep/Dir/", "my.database_uuid", "custom user file".toByteArray())

            val sourceEntity = UsbSource("src_uuid_test", 1, 2, "SN", null, "Drive", 1L, 1L)
            db.sourceDao().insertSource(sourceEntity.toEntity())
            val job = BackupJob("job_uuid_test", "src_uuid_test", BackupJobState.SCANNING, 100L)
            jobRepository.createJob(job)

            val files = scanner.scanSource("job_uuid_test", fakeSource)

            // Verify exactly the 4 user files are discovered
            assertEquals(4, files.size)

            val discoveredMap = files.associate { it.originalName to it.relativePath }
            assertEquals("", discoveredMap["database_uuid.txt"])
            assertEquals("Notes/", discoveredMap["database_uuid.pdf"])
            assertEquals("Data/", discoveredMap["database.sqlite"])
            assertEquals("Deep/Dir/", discoveredMap["my.database_uuid"])

            // Explicitly assert that no .database_uuid file variant is present in candidates
            for (file in files) {
                assertTrue(
                    "No file named .database_uuid (any case) should be a candidate: ${file.originalName}",
                    !file.originalName.equals(".database_uuid", ignoreCase = true)
                )
            }
        }
    }

    @Test
    fun testUnavailableSourceThrows() {
        val fakeSource = FakeStorageSource("src4", "Unavailable Drive", available = false)
        val job = BackupJob("job4", "src4", BackupJobState.SCANNING, 100L)

        assertThrows(IOException::class.java) {
            runBlocking {
                scanner.scanSource("job4", fakeSource)
            }
        }
    }
}
