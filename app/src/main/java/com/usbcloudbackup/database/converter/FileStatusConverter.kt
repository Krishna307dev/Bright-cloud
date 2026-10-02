package com.usbcloudbackup.database.converter

import androidx.room.TypeConverter
import com.usbcloudbackup.backup.model.FileStatus

class FileStatusConverter {
    @TypeConverter
    fun fromStatus(status: FileStatus): String = status.name

    @TypeConverter
    fun toStatus(value: String): FileStatus = FileStatus.valueOf(value)
}
