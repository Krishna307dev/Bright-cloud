package com.usbcloudbackup.storage

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import com.usbcloudbackup.policy.BackupPolicyEngine
import java.io.IOException

class SafStorageSource(
    override val sourceId: String,
    override val displayName: String,
    private val context: Context,
    private val treeUri: Uri,
    private val contentResolver: ContentResolver = context.contentResolver
) : UsbStorageSource {

    companion object {
        private const val TAG = "SafStorageSource"

        private val CHILD_PROJECTION = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        )
    }

    private data class SafChildEntry(
        val documentId: String,
        val displayName: String,
        val mimeType: String?,
        val size: Long,
        val lastModified: Long
    )

    override suspend fun isAvailable(): Boolean {
        return try {
            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            val rootDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId)
            contentResolver.query(
                rootDocUri,
                arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
                null,
                null,
                null
            )?.use { cursor ->
                cursor.moveToFirst()
            } ?: false
        } catch (e: Exception) {
            Log.w(TAG, "isAvailable check failed for treeUri=$treeUri: ${e.message}")
            false
        }
    }

    override suspend fun discoverFiles(): List<DiscoveredFileDescriptor> {
        if (!isAvailable()) {
            throw IOException("USB SAF storage root is unavailable or unreadable: $treeUri")
        }

        val descriptors = mutableListOf<DiscoveredFileDescriptor>()
        val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
        traverseDirectory(rootDocId, "", descriptors)
        return descriptors
    }

    private fun traverseDirectory(
        parentDocumentId: String,
        currentRelativePath: String,
        outList: MutableList<DiscoveredFileDescriptor>
    ) {
        val childrenUri = try {
            DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to build child documents URI for parentId=$parentDocumentId: ${e.message}")
            return
        }

        val childEntries = mutableListOf<SafChildEntry>()

        try {
            contentResolver.query(
                childrenUri,
                CHILD_PROJECTION,
                null,
                null,
                null
            )?.use { cursor ->
                val idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
                val sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
                val lastModIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)

                while (cursor.moveToNext()) {
                    val docId = if (idIndex >= 0) cursor.getString(idIndex) else null
                    val name = if (nameIndex >= 0) cursor.getString(nameIndex) else null
                    val mimeType = if (mimeIndex >= 0) cursor.getString(mimeIndex) else null
                    val size = if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex) else 0L
                    val lastModified = if (lastModIndex >= 0 && !cursor.isNull(lastModIndex)) cursor.getLong(lastModIndex) else 0L

                    if (docId != null && name != null) {
                        childEntries.add(SafChildEntry(docId, name, mimeType, size, lastModified))
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Exception querying children for parentId=$parentDocumentId: ${e.message}")
            return
        }

        // Sort child entries by display name for deterministic traversal ordering
        val sortedEntries = childEntries.sortedBy { it.displayName }

        val isRoot = currentRelativePath.isEmpty()

        for (entry in sortedEntries) {
            if (entry.mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
                if (BackupPolicyEngine.isExcludedDirectory(entry.displayName, isRoot)) {
                    Log.d(TAG, "Skipping excluded system directory in SAF: ${entry.displayName} (isRoot=$isRoot)")
                    continue
                }
                val nextRelativePath = if (isRoot) {
                    "${entry.displayName}/"
                } else {
                    "$currentRelativePath${entry.displayName}/"
                }
                traverseDirectory(entry.documentId, nextRelativePath, outList)
            } else {
                if (BackupPolicyEngine.isExcludedFile(entry.displayName)) {
                    Log.d(TAG, "Skipping excluded system file in SAF: ${entry.displayName}")
                    continue
                }
                try {
                    val childDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, entry.documentId)
                    val descriptor = DiscoveredFileDescriptor(
                        relativePath = currentRelativePath,
                        originalName = entry.displayName,
                        size = entry.size,
                        lastModified = entry.lastModified,
                        mimeType = entry.mimeType,
                        openInputStream = {
                            contentResolver.openInputStream(childDocUri)
                                ?: throw IOException("ContentResolver returned null InputStream for URI: $childDocUri")
                        }
                    )
                    outList.add(descriptor)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to create descriptor for file ${entry.displayName}: ${e.message}")
                }
            }
        }
    }
}
