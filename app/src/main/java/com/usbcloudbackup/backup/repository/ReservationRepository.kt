package com.usbcloudbackup.backup.repository

import com.usbcloudbackup.backup.model.NameReservation
import com.usbcloudbackup.backup.model.ReservationStatus
import com.usbcloudbackup.backup.model.toDomain
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.database.dao.NameReservationDao

class ReservationRepository(private val nameReservationDao: NameReservationDao) {

    suspend fun saveReservation(reservation: NameReservation) {
        nameReservationDao.insertReservation(reservation.toEntity())
    }

    suspend fun updateReservationStatus(reservationId: String, newStatus: ReservationStatus) {
        val current = nameReservationDao.getReservationById(reservationId)
        val validatedStatus = current?.status?.transitionTo(newStatus) ?: newStatus
        nameReservationDao.updateReservationStatus(reservationId, validatedStatus)
    }

    suspend fun getReservation(reservationId: String): NameReservation? {
        return nameReservationDao.getReservationById(reservationId)?.toDomain()
    }

    suspend fun getReservationsByJob(jobId: String): List<NameReservation> {
        return nameReservationDao.getReservationsByJob(jobId).map { it.toDomain() }
    }

    suspend fun getPendingExpiredReservations(currentTime: Long = System.currentTimeMillis()): List<NameReservation> {
        return nameReservationDao.getPendingExpiredReservations(currentTime).map { it.toDomain() }
    }

    suspend fun deleteExpiredReservations(currentTime: Long = System.currentTimeMillis()): Int {
        return nameReservationDao.deleteExpiredReservations(currentTime)
    }

    suspend fun deleteReservation(reservationId: String) {
        nameReservationDao.deleteReservation(reservationId)
    }
}
