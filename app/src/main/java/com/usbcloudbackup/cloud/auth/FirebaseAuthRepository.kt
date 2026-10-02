package com.usbcloudbackup.cloud.auth

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.tasks.await

class FirebaseAuthRepository(
    private val firebaseAuth: FirebaseAuth = FirebaseAuth.getInstance()
) : AuthRepository {

    companion object {
        private const val TAG = "FirebaseAuthRepository"
    }

    override fun getCurrentUid(): String? {
        return firebaseAuth.currentUser?.uid
    }

    override fun isAuthenticated(): Boolean {
        return firebaseAuth.currentUser != null
    }

    override suspend fun ensureAuthenticated(): String {
        val currentUser = firebaseAuth.currentUser
        if (currentUser != null) {
            Log.d(TAG, "Existing authenticated user found. uid=${currentUser.uid}, isAnonymous=${currentUser.isAnonymous}")
            return currentUser.uid
        }

        Log.i(TAG, "No authenticated user. Performing anonymous sign-in...")
        val authResult = firebaseAuth.signInAnonymously().await()
        val user = authResult.user
        checkNotNull(user) { "Firebase anonymous sign-in returned null user." }

        Log.i(TAG, "Anonymous sign-in successful. uid=${user.uid}")
        return user.uid
    }

    override fun getAuthMethod(): String {
        val currentUser = firebaseAuth.currentUser ?: return "unauthenticated"
        return if (currentUser.isAnonymous) "anonymous" else "email"
    }

    override suspend fun getIdToken(forceRefresh: Boolean): String? {
        return try {
            firebaseAuth.currentUser?.getIdToken(forceRefresh)?.await()?.token
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch Firebase ID token: ${e.message}")
            null
        }
    }
}
