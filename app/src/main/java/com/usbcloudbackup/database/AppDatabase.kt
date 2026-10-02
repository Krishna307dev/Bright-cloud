package com.usbcloudbackup.database

import android.content.Context
import androidx.annotation.VisibleForTesting
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.usbcloudbackup.database.converter.BackupJobStateConverter
import com.usbcloudbackup.database.converter.FileStatusConverter
import com.usbcloudbackup.database.converter.ReservationStatusConverter
import com.usbcloudbackup.database.converter.UploadTaskStateConverter
import com.usbcloudbackup.database.dao.BackupJobDao
import com.usbcloudbackup.database.dao.FileDao
import com.usbcloudbackup.database.dao.NameReservationDao
import com.usbcloudbackup.database.dao.SourceDao
import com.usbcloudbackup.database.dao.UploadTaskDao
import com.usbcloudbackup.database.entity.BackupJobEntity
import com.usbcloudbackup.database.entity.FileEntity
import com.usbcloudbackup.database.entity.NameReservationEntity
import com.usbcloudbackup.database.entity.SourceEntity
import com.usbcloudbackup.database.entity.UploadTaskEntity

@Database(
    entities = [
        SourceEntity::class,
        BackupJobEntity::class,
        FileEntity::class,
        UploadTaskEntity::class,
        NameReservationEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(
    BackupJobStateConverter::class,
    FileStatusConverter::class,
    UploadTaskStateConverter::class,
    ReservationStatusConverter::class
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun sourceDao(): SourceDao
    abstract fun backupJobDao(): BackupJobDao
    abstract fun fileDao(): FileDao
    abstract fun uploadTaskDao(): UploadTaskDao
    abstract fun nameReservationDao(): NameReservationDao

    companion object {
        private const val DATABASE_NAME = "usb_cloud_backup.db"

        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
        }

        @VisibleForTesting
        fun setTestInstance(database: AppDatabase?) {
            synchronized(this) {
                INSTANCE = database
            }
        }

        private fun buildDatabase(context: Context): AppDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                DATABASE_NAME
            ).build()
        }
    }
}
