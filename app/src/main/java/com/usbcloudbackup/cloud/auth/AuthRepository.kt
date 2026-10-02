package com.usbcloudbackup.cloud.auth

interface AuthRepository {
    fun getCurrentUid(): String?
    fun isAuthenticated(): Boolean
    suspend fun ensureAuthenticated(): String
    fun getAuthMethod(): String
    suspend fun getIdToken(forceRefresh: Boolean = false): String? = null
}
