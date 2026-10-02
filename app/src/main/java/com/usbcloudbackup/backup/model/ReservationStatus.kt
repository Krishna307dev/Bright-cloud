package com.usbcloudbackup.backup.model

enum class ReservationStatus {
    PENDING,
    COMMITTED,
    EXPIRED;

    fun canTransitionTo(nextStatus: ReservationStatus): Boolean {
        if (this == nextStatus) return true
        return when (this) {
            PENDING -> nextStatus in listOf(COMMITTED, EXPIRED)
            COMMITTED -> false // Terminal lock (never expires or changes)
            EXPIRED -> nextStatus == PENDING // Overwritten by new reservation
        }
    }

    fun transitionTo(nextStatus: ReservationStatus): ReservationStatus {
        check(canTransitionTo(nextStatus)) {
            "Illegal ReservationStatus transition from $this to $nextStatus"
        }
        return nextStatus
    }
}
