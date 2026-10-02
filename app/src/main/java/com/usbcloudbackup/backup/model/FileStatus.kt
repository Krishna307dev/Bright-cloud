package com.usbcloudbackup.backup.model

enum class FileStatus {
    DISCOVERED,
    METADATA_INDEXED,
    HASHING,
    HASHED,
    SKIPPED_DUPLICATE,
    NAME_RESERVING,
    NAME_RESERVED,
    UPLOADING,
    UPLOADED_NOT_INDEXED,
    INDEXED,
    FAILED,
    SOURCE_UNAVAILABLE;

    fun canTransitionTo(nextStatus: FileStatus): Boolean {
        if (this == nextStatus) return true
        return when (this) {
            DISCOVERED -> nextStatus in listOf(HASHING, METADATA_INDEXED, FAILED, SOURCE_UNAVAILABLE)
            METADATA_INDEXED -> nextStatus in listOf(HASHING, FAILED, SOURCE_UNAVAILABLE)
            HASHING -> nextStatus in listOf(HASHED, FAILED, SOURCE_UNAVAILABLE)
            HASHED -> nextStatus in listOf(SKIPPED_DUPLICATE, NAME_RESERVING, NAME_RESERVED, FAILED, SOURCE_UNAVAILABLE)
            SKIPPED_DUPLICATE -> false // Terminal for skipped files
            NAME_RESERVING -> nextStatus in listOf(NAME_RESERVED, FAILED, SOURCE_UNAVAILABLE)
            NAME_RESERVED -> nextStatus in listOf(UPLOADING, FAILED, SOURCE_UNAVAILABLE)
            UPLOADING -> nextStatus in listOf(UPLOADED_NOT_INDEXED, FAILED, SOURCE_UNAVAILABLE)
            UPLOADED_NOT_INDEXED -> nextStatus in listOf(INDEXED, FAILED)
            INDEXED -> false // Terminal success
            SOURCE_UNAVAILABLE -> nextStatus in listOf(
                DISCOVERED, METADATA_INDEXED, HASHING, HASHED, NAME_RESERVING, NAME_RESERVED, UPLOADING, FAILED
            ) // Can resume on USB reconnect
            FAILED -> nextStatus in listOf(
                DISCOVERED, METADATA_INDEXED, HASHING, HASHED, NAME_RESERVING, NAME_RESERVED, UPLOADING
            ) // Can retry
        }
    }

    fun transitionTo(nextStatus: FileStatus): FileStatus {
        check(canTransitionTo(nextStatus)) {
            "Illegal FileStatus transition from $this to $nextStatus"
        }
        return nextStatus
    }
}
