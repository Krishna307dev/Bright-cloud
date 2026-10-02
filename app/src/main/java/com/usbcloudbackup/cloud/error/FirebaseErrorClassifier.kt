package com.usbcloudbackup.cloud.error

import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.firestore.FirebaseFirestoreException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

enum class ErrorCategory {
    NETWORK,
    AUTHENTICATION,
    PERMISSION_DENIED,
    QUOTA,
    TRANSIENT,
    PERMANENT,
    SOURCE_UNAVAILABLE,
    UNKNOWN
}

data class ClassifiedError(
    val category: ErrorCategory,
    val isRetryable: Boolean,
    val message: String,
    val cause: Throwable?
)

object FirebaseErrorClassifier {

    fun classify(throwable: Throwable): ClassifiedError {
        return when (throwable) {
            is UnknownHostException, is SocketTimeoutException -> ClassifiedError(
                category = ErrorCategory.NETWORK,
                isRetryable = true,
                message = "Network connection failed or timed out: ${throwable.message}",
                cause = throwable
            )
            is FirebaseAuthException -> ClassifiedError(
                category = ErrorCategory.AUTHENTICATION,
                isRetryable = true,
                message = "Authentication failure: ${throwable.message} [code=${throwable.errorCode}]",
                cause = throwable
            )
            is FirebaseFirestoreException -> classifyFirestoreException(throwable)
            is IOException -> ClassifiedError(
                category = ErrorCategory.SOURCE_UNAVAILABLE,
                isRetryable = true,
                message = "I/O error accessing storage: ${throwable.message}",
                cause = throwable
            )
            else -> ClassifiedError(
                category = ErrorCategory.UNKNOWN,
                isRetryable = false,
                message = throwable.message ?: "Unknown error occurred",
                cause = throwable
            )
        }
    }

    private fun classifyFirestoreException(e: FirebaseFirestoreException): ClassifiedError {
        return when (e.code) {
            FirebaseFirestoreException.Code.PERMISSION_DENIED -> ClassifiedError(
                category = ErrorCategory.PERMISSION_DENIED,
                isRetryable = false,
                message = "Firestore permission denied by security rules: ${e.message}",
                cause = e
            )
            FirebaseFirestoreException.Code.UNAVAILABLE,
            FirebaseFirestoreException.Code.DEADLINE_EXCEEDED,
            FirebaseFirestoreException.Code.ABORTED -> ClassifiedError(
                category = ErrorCategory.TRANSIENT,
                isRetryable = true,
                message = "Firestore transient error: ${e.message}",
                cause = e
            )
            FirebaseFirestoreException.Code.RESOURCE_EXHAUSTED -> ClassifiedError(
                category = ErrorCategory.QUOTA,
                isRetryable = false,
                message = "Firestore quota exceeded: ${e.message}",
                cause = e
            )
            FirebaseFirestoreException.Code.UNAUTHENTICATED -> ClassifiedError(
                category = ErrorCategory.AUTHENTICATION,
                isRetryable = true,
                message = "Firestore unauthenticated: ${e.message}",
                cause = e
            )
            else -> ClassifiedError(
                category = ErrorCategory.PERMANENT,
                isRetryable = false,
                message = "Firestore permanent failure [code=${e.code}]: ${e.message}",
                cause = e
            )
        }
    }
}
