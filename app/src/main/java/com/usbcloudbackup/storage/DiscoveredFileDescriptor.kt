package com.usbcloudbackup.storage

import java.io.InputStream

data class DiscoveredFileDescriptor(
    val relativePath: String, // Relative directory path from USB root (e.g., "Notes/Math/"). Trailing slash included if non-empty.
    val originalName: String,
    val size: Long,
    val lastModified: Long,
    val mimeType: String? = null,
    val openInputStream: () -> InputStream
)
