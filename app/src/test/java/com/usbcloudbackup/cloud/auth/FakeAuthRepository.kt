package com.usbcloudbackup.cloud.auth

class FakeAuthRepository(
    var authUid: String? = "test_anonymous_device_uid",
    var isAnonymous: Boolean = true
) : AuthRepository {

    override fun getCurrentUid(): String? = authUid

    override fun isAuthenticated(): Boolean = authUid != null

    override suspend fun ensureAuthenticated(): String {
        if (authUid == null) {
            authUid = "new_anonymous_device_uid"
            isAnonymous = true
        }
        return authUid!!
    }

    override fun getAuthMethod(): String {
        if (authUid == null) return "unauthenticated"
        return if (isAnonymous) "anonymous" else "google.com"
    }

    override suspend fun getIdToken(forceRefresh: Boolean): String? {
        return "fake_firebase_jwt_for_${authUid}"
    }
}
