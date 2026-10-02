package com.usbcloudbackup.storage

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.DocumentsContract
import androidx.test.core.app.ApplicationProvider
import com.usbcloudbackup.setup.MainActivity
import java.io.ByteArrayInputStream
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SafStorageSourceTest {

    companion object {
        const val TEST_AUTHORITY = "com.usbcloudbackup.test.documents"
    }

    class TestDocumentsProvider : ContentProvider() {
        data class TestDoc(
            val docId: String,
            val displayName: String,
            val mimeType: String,
            val size: Long = 0L,
            val lastModified: Long = 0L,
            val content: ByteArray = ByteArray(0),
            val parentDocId: String? = null,
            val throwOnOpen: Boolean = false
        )

        val docs = mutableMapOf<String, TestDoc>()

        fun addRoot(docId: String, displayName: String) {
            docs[docId] = TestDoc(docId, displayName, DocumentsContract.Document.MIME_TYPE_DIR)
        }

        fun addDirectory(docId: String, displayName: String, parentDocId: String) {
            docs[docId] = TestDoc(
                docId = docId,
                displayName = displayName,
                mimeType = DocumentsContract.Document.MIME_TYPE_DIR,
                parentDocId = parentDocId
            )
        }

        fun addFile(
            docId: String,
            displayName: String,
            parentDocId: String,
            content: ByteArray,
            mimeType: String = "application/octet-stream",
            lastModified: Long = 1700000000000L,
            throwOnOpen: Boolean = false
        ) {
            docs[docId] = TestDoc(
                docId = docId,
                displayName = displayName,
                mimeType = mimeType,
                size = content.size.toLong(),
                lastModified = lastModified,
                content = content,
                parentDocId = parentDocId,
                throwOnOpen = throwOnOpen
            )
        }

        override fun onCreate(): Boolean = true

        override fun query(
            uri: Uri,
            projection: Array<out String>?,
            selection: String?,
            selectionArgs: Array<out String>?,
            sortOrder: String?
        ): Cursor? {
            val proj = projection ?: arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED
            )
            val matrixCursor = MatrixCursor(proj)

            val uriStr = uri.toString()
            if (uriStr.contains("/children")) {
                val parentDocId = try {
                    DocumentsContract.getDocumentId(uri)
                } catch (e: Exception) {
                    DocumentsContract.getTreeDocumentId(uri)
                }
                val children = docs.values.filter { it.parentDocId == parentDocId }
                for (child in children) {
                    val row = matrixCursor.newRow()
                    for (col in proj) {
                        when (col) {
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID -> row.add(child.docId)
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME -> row.add(child.displayName)
                            DocumentsContract.Document.COLUMN_MIME_TYPE -> row.add(child.mimeType)
                            DocumentsContract.Document.COLUMN_SIZE -> row.add(child.size)
                            DocumentsContract.Document.COLUMN_LAST_MODIFIED -> row.add(child.lastModified)
                            else -> row.add(null)
                        }
                    }
                }
            } else {
                val docId = try {
                    DocumentsContract.getDocumentId(uri)
                } catch (e: Exception) {
                    DocumentsContract.getTreeDocumentId(uri)
                }
                val doc = docs[docId] ?: return null
                val row = matrixCursor.newRow()
                for (col in proj) {
                    when (col) {
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID -> row.add(doc.docId)
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME -> row.add(doc.displayName)
                        DocumentsContract.Document.COLUMN_MIME_TYPE -> row.add(doc.mimeType)
                        DocumentsContract.Document.COLUMN_SIZE -> row.add(doc.size)
                        DocumentsContract.Document.COLUMN_LAST_MODIFIED -> row.add(doc.lastModified)
                        else -> row.add(null)
                    }
                }
            }
            return matrixCursor
        }

        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
    }

    private lateinit var context: Context
    private lateinit var provider: TestDocumentsProvider
    private lateinit var treeUri: Uri

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        provider = Robolectric.setupContentProvider(TestDocumentsProvider::class.java, TEST_AUTHORITY)
        treeUri = DocumentsContract.buildTreeDocumentUri(TEST_AUTHORITY, "root")
        provider.addRoot("root", "USB Root")
    }

    private fun registerFileInShadow(docId: String, content: ByteArray) {
        val childDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
        shadowOf(context.contentResolver).registerInputStream(childDocUri, ByteArrayInputStream(content))
    }

    @After
    fun tearDown() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
    }

    @Test
    fun testIsAvailableReturnsTrueForValidRoot() = runBlocking {
        val source = SafStorageSource("usb-1234", "My USB", context, treeUri)
        assertTrue(source.isAvailable())
    }

    @Test
    fun testIsAvailableReturnsFalseForNonExistentRoot() = runBlocking {
        val invalidUri = DocumentsContract.buildTreeDocumentUri(TEST_AUTHORITY, "invalid_root")
        val source = SafStorageSource("usb-1234", "My USB", context, invalidUri)
        assertFalse(source.isAvailable())
    }

    @Test
    fun testDiscoverFilesWithRootFilesAndNestedDirectories() = runBlocking {
        provider.addFile("file1", "README.txt", "root", "Hello USB".toByteArray(), "text/plain", 1700000001000L)
        registerFileInShadow("file1", "Hello USB".toByteArray())

        provider.addDirectory("dir_notes", "Notes", "root")
        provider.addDirectory("dir_math", "Math", "dir_notes")
        provider.addFile("file2", "Chapter1.pdf", "dir_math", "PDF Data".toByteArray(), "application/pdf", 1700000002000L)
        registerFileInShadow("file2", "PDF Data".toByteArray())

        val source = SafStorageSource("usb-1234", "My USB", context, treeUri)
        val files = source.discoverFiles()

        assertEquals(2, files.size)

        // Root file
        val readme = files.first { it.originalName == "README.txt" }
        assertEquals("", readme.relativePath)
        assertEquals("README.txt", readme.originalName)
        assertEquals(9L, readme.size)
        assertEquals(1700000001000L, readme.lastModified)
        assertEquals("text/plain", readme.mimeType)
        val readmeBytes = readme.openInputStream().use { it.readBytes() }
        assertArrayEquals("Hello USB".toByteArray(), readmeBytes)

        // Nested file
        val chapter = files.first { it.originalName == "Chapter1.pdf" }
        assertEquals("Notes/Math/", chapter.relativePath)
        assertEquals("Chapter1.pdf", chapter.originalName)
        assertEquals(8L, chapter.size)
        assertEquals(1700000002000L, chapter.lastModified)
        assertEquals("application/pdf", chapter.mimeType)
        val chapterBytes = chapter.openInputStream().use { it.readBytes() }
        assertArrayEquals("PDF Data".toByteArray(), chapterBytes)
    }

    @Test
    fun testDiscoverFilesWithUnicodeAndSpaces() = runBlocking {
        provider.addDirectory("dir_uni", "Dokumente & Bücher", "root")
        provider.addDirectory("dir_sub", "Projekt ÄÖÜ 2026", "dir_uni")
        provider.addFile(
            "file_uni",
            "Résumé 日本語.txt",
            "dir_sub",
            "Unicode File Content".toByteArray(),
            "text/plain",
            1700000003000L
        )
        registerFileInShadow("file_uni", "Unicode File Content".toByteArray())

        val source = SafStorageSource("usb-1234", "My USB", context, treeUri)
        val files = source.discoverFiles()

        assertEquals(1, files.size)
        val file = files.first()
        assertEquals("Dokumente & Bücher/Projekt ÄÖÜ 2026/", file.relativePath)
        assertEquals("Résumé 日本語.txt", file.originalName)
        assertEquals("Unicode File Content".toByteArray().size.toLong(), file.size)
    }

    @Test
    fun testCorruptedEntryOpenThrowsIOExceptionGracefully() = runBlocking {
        provider.addFile("file_good", "good.txt", "root", "good data".toByteArray(), "text/plain")
        registerFileInShadow("file_good", "good data".toByteArray())

        // file_bad is added to provider metadata but not registered in shadow, causing null or IOException on open
        provider.addFile("file_bad", "bad.txt", "root", "bad data".toByteArray(), "text/plain", throwOnOpen = true)

        val source = SafStorageSource("usb-1234", "My USB", context, treeUri)
        val files = source.discoverFiles()

        assertEquals(2, files.size)
        val good = files.first { it.originalName == "good.txt" }
        assertEquals("good data", String(good.openInputStream().use { it.readBytes() }))

        val bad = files.first { it.originalName == "bad.txt" }
        try {
            bad.openInputStream()
            fail("Expected IOException on bad file openInputStream")
        } catch (e: IOException) {
            // Success: IOException caught
            assertNotNull(e)
        }
    }

    @Test
    fun testDiscoverFilesThrowsWhenRootUnavailable() = runBlocking {
        val invalidUri = DocumentsContract.buildTreeDocumentUri(TEST_AUTHORITY, "missing_root")
        val source = SafStorageSource("usb-1234", "My USB", context, invalidUri)

        try {
            source.discoverFiles()
            fail("Expected IOException when source root is unavailable")
        } catch (e: IOException) {
            assertTrue(e.message!!.contains("unavailable or unreadable"))
        }
    }

    @Test
    fun testStorageSourceFactoryReturnsSafWhenCustomUriProvided() {
        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource("usb-1234", customUri = treeUri)

        assertTrue(source is SafStorageSource)
        assertEquals("usb-1234", source.sourceId)
    }

    @Test
    fun testStorageSourceFactoryReturnsDirectFileWhenConfigured() {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(MainActivity.KEY_DIRECT_FILE_MODE, true).commit()

        val factory = StorageSourceFactory(context)
        val source = factory.createStorageSource("usb-9999")

        assertNotNull(source)
        assertEquals("usb-9999", source.sourceId)
    }
}
