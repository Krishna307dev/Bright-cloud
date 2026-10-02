package com.usbcloudbackup.cloud.storage.b2

import android.content.Context
import androidx.annotation.VisibleForTesting

interface IPendingDeletionStore {
    fun recordPendingDeletion(cloudObjectPath: String)
    fun removePendingDeletion(cloudObjectPath: String)
    fun getPendingDeletions(): Set<String>
    fun clear()
}

class PendingDeletionStore(context: Context) : IPendingDeletionStore {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS_NAME = "pending_b2_deletions"
        private const val KEY_DELETIONS = "pending_object_keys"

        @get:VisibleForTesting
        @set:VisibleForTesting
        var testInstance: IPendingDeletionStore? = null

        fun getInstance(context: Context): IPendingDeletionStore {
            return testInstance ?: PendingDeletionStore(context.applicationContext)
        }
    }

    override fun recordPendingDeletion(cloudObjectPath: String) {
        if (cloudObjectPath.isBlank()) return
        synchronized(this) {
            val current = prefs.getStringSet(KEY_DELETIONS, emptySet())?.toMutableSet() ?: mutableSetOf()
            current.add(cloudObjectPath)
            prefs.edit().putStringSet(KEY_DELETIONS, current).commit()
        }
    }

    override fun removePendingDeletion(cloudObjectPath: String) {
        if (cloudObjectPath.isBlank()) return
        synchronized(this) {
            val current = prefs.getStringSet(KEY_DELETIONS, emptySet())?.toMutableSet() ?: mutableSetOf()
            if (current.remove(cloudObjectPath)) {
                prefs.edit().putStringSet(KEY_DELETIONS, current).commit()
            }
        }
    }

    override fun getPendingDeletions(): Set<String> {
        synchronized(this) {
            return prefs.getStringSet(KEY_DELETIONS, emptySet())?.toSet() ?: emptySet()
        }
    }

    override fun clear() {
        synchronized(this) {
            prefs.edit().remove(KEY_DELETIONS).commit()
        }
    }
}
