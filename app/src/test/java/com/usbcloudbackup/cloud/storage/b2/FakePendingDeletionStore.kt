package com.usbcloudbackup.cloud.storage.b2

class FakePendingDeletionStore : IPendingDeletionStore {
    val recordedDeletions = mutableSetOf<String>()

    override fun recordPendingDeletion(cloudObjectPath: String) {
        if (cloudObjectPath.isNotBlank()) {
            recordedDeletions.add(cloudObjectPath)
        }
    }

    override fun removePendingDeletion(cloudObjectPath: String) {
        recordedDeletions.remove(cloudObjectPath)
    }

    override fun getPendingDeletions(): Set<String> {
        return recordedDeletions.toSet()
    }

    override fun clear() {
        recordedDeletions.clear()
    }
}
