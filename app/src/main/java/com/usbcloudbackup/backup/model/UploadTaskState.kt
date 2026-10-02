package com.usbcloudbackup.backup.model

enum class UploadTaskState {
    RESERVING,
    RESERVED,
    UPLOADING,
    UPLOADED_NOT_INDEXED,
    INDEXED,
    FAILED;

    fun canTransitionTo(nextState: UploadTaskState): Boolean {
        if (this == nextState) return true
        return when (this) {
            RESERVING -> nextState in listOf(RESERVED, FAILED)
            RESERVED -> nextState in listOf(UPLOADING, FAILED)
            UPLOADING -> nextState in listOf(UPLOADED_NOT_INDEXED, FAILED)
            UPLOADED_NOT_INDEXED -> nextState in listOf(INDEXED, FAILED)
            INDEXED -> false // Terminal
            FAILED -> nextState in listOf(RESERVING, RESERVED, UPLOADING, UPLOADED_NOT_INDEXED) // Retry
        }
    }

    fun transitionTo(nextState: UploadTaskState): UploadTaskState {
        check(canTransitionTo(nextState)) {
            "Illegal UploadTaskState transition from $this to $nextState"
        }
        return nextState
    }
}
