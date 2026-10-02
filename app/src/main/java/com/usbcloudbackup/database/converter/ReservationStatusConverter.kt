package com.usbcloudbackup.database.converter

import androidx.room.TypeConverter
import com.usbcloudbackup.backup.model.ReservationStatus

class ReservationStatusConverter {
    @TypeConverter
    fun fromStatus(status: ReservationStatus): String = status.name

    @TypeConverter
    fun toStatus(value: String): ReservationStatus = ReservationStatus.valueOf(value)
}
