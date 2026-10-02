package com.usbcloudbackup.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.usbcloudbackup.backup.model.ReservationStatus

@Entity(
    tableName = "name_reservations",
    indices = [
        Index(value = ["jobId"]),
        Index(value = ["ownerTaskId"]),
        Index(value = ["status", "expiresAt"])
    ]
)
data class NameReservationEntity(
    @PrimaryKey val reservationId: String, // {sourceId}_{relativePath}_{storedName}
    val sha256: String,
    val b2ObjectKey: String,
    val sourceId: String,
    val relativePath: String,
    val originalName: String,
    val storedName: String,
    val version: Int,
    val status: ReservationStatus, // PENDING, COMMITTED, EXPIRED
    val jobId: String,
    val ownerTaskId: String,
    val createdAt: Long,
    val expiresAt: Long // createdAt + 24 hours (86400000 ms)
)
