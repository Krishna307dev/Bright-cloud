package com.usbcloudbackup.database.converter

import androidx.room.TypeConverter
import com.usbcloudbackup.backup.model.UploadTaskState

class UploadTaskStateConverter {
    @TypeConverter
    fun fromState(state: UploadTaskState): String = state.name

    @TypeConverter
    fun toState(value: String): UploadTaskState = UploadTaskState.valueOf(value)
}
