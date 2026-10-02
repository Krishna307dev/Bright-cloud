package com.usbcloudbackup.backup

data class ReservedNameResult(
    val storedName: String,
    val version: Int,
    val reservationId: String,
    val b2ObjectKey: String,
    val isReused: Boolean = false
)
