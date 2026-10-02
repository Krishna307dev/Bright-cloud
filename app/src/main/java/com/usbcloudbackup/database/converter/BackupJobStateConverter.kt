package com.usbcloudbackup.database.converter

import androidx.room.TypeConverter
import com.usbcloudbackup.backup.model.BackupJobState

class BackupJobStateConverter {
    @TypeConverter
    fun fromState(state: BackupJobState): String = state.name

    @TypeConverter
    fun toState(value: String): BackupJobState = BackupJobState.valueOf(value)
}
