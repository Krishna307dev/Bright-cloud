package com.usbcloudbackup.backup.model

enum class BackupJobState {
    SCANNING,
    HASHING,
    DEDUPLICATING,
    UPLOADING,
    COMPLETED,
    FAILED,
    CANCELLED;

    fun canTransitionTo(nextState: BackupJobState): Boolean {
        if (this == nextState) return true
        return when (this) {
            SCANNING -> nextState in listOf(HASHING, FAILED, CANCELLED)
            HASHING -> nextState in listOf(DEDUPLICATING, FAILED, CANCELLED)
            DEDUPLICATING -> nextState in listOf(UPLOADING, COMPLETED, FAILED, CANCELLED)
            UPLOADING -> nextState in listOf(COMPLETED, FAILED, CANCELLED)
            FAILED -> nextState in listOf(SCANNING, HASHING, DEDUPLICATING, UPLOADING) // Retry
            CANCELLED -> nextState in listOf(SCANNING, HASHING, DEDUPLICATING, UPLOADING) // Resume
            COMPLETED -> false // Terminal
        }
    }

    fun transitionTo(nextState: BackupJobState): BackupJobState {
        check(canTransitionTo(nextState)) {
            "Illegal BackupJobState transition from $this to $nextState"
        }
        return nextState
    }
}
