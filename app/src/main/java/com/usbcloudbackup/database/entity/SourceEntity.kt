package com.usbcloudbackup.database.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sources")
data class SourceEntity(
    @PrimaryKey val sourceId: String, // {vendorId}-{productId}-{serialOrHash}
    val usbVendorId: Int,
    val usbProductId: Int,
    val serialNumber: String?,
    val volumeUuid: String?,
    val displayName: String,
    val firstSeen: Long, // Epoch millis
    val lastSeen: Long   // Epoch millis
)
