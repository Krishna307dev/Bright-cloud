package com.usbcloudbackup.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.usbcloudbackup.database.entity.SourceEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SourceDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSource(source: SourceEntity)

    @Update
    suspend fun updateSource(source: SourceEntity)

    @Query("SELECT * FROM sources WHERE sourceId = :sourceId")
    suspend fun getSourceById(sourceId: String): SourceEntity?

    @Query("SELECT * FROM sources WHERE sourceId = :sourceId")
    fun observeSourceById(sourceId: String): Flow<SourceEntity?>

    @Query("SELECT * FROM sources ORDER BY lastSeen DESC")
    suspend fun getAllSources(): List<SourceEntity>
}
