package com.usbcloudbackup.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.database.entity.NameReservationEntity

@Dao
interface NameReservationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReservation(reservation: NameReservationEntity)

    @Update
    suspend fun updateReservation(reservation: NameReservationEntity)

    @Query("UPDATE name_reservations SET status = :status WHERE reservationId = :reservationId")
    suspend fun updateReservationStatus(reservationId: String, status: ReservationStatus)

    @Query("SELECT * FROM name_reservations WHERE reservationId = :reservationId")
    suspend fun getReservationById(reservationId: String): NameReservationEntity?

    @Query("SELECT * FROM name_reservations WHERE jobId = :jobId")
    suspend fun getReservationsByJob(jobId: String): List<NameReservationEntity>

    @Query("SELECT * FROM name_reservations WHERE status = 'PENDING' AND expiresAt < :currentTime")
    suspend fun getPendingExpiredReservations(currentTime: Long): List<NameReservationEntity>

    @Query("DELETE FROM name_reservations WHERE reservationId = :reservationId")
    suspend fun deleteReservation(reservationId: String)

    @Query("DELETE FROM name_reservations WHERE status = 'PENDING' AND expiresAt < :currentTime")
    suspend fun deleteExpiredReservations(currentTime: Long): Int
}
