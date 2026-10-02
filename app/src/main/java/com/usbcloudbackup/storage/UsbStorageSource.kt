package com.usbcloudbackup.storage

interface UsbStorageSource {
    val sourceId: String
    val displayName: String
    suspend fun discoverFiles(): List<DiscoveredFileDescriptor>
    suspend fun isAvailable(): Boolean
}
