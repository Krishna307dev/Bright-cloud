package com.usbcloudbackup.backup.model

data class NameReservation(
    val reservationId: String,
    val sha256: String,
    val b2ObjectKey: String,
    val sourceId: String,
    val relativePath: String,
    val originalName: String,
    val storedName: String,
    val version: Int,
    val status: ReservationStatus,
    val jobId: String,
    val ownerTaskId: String,
    val createdAt: Long,
    val expiresAt: Long
)
