package com.usbcloudbackup.backup.model

data class UsbSource(
    val sourceId: String,
    val usbVendorId: Int,
    val usbProductId: Int,
    val serialNumber: String?,
    val volumeUuid: String?,
    val displayName: String,
    val firstSeen: Long,
    val lastSeen: Long
)
