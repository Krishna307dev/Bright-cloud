package com.usbcloudbackup.cloud.error

import com.google.firebase.firestore.FirebaseFirestoreException
import io.mockk.every
import io.mockk.mockk
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FirebaseErrorClassifierTest {

    @Test
    fun testNetworkExceptionClassification() {
        val unknownHost = FirebaseErrorClassifier.classify(UnknownHostException("Unable to resolve host"))
        assertEquals(ErrorCategory.NETWORK, unknownHost.category)
        assertTrue(unknownHost.isRetryable)

        val timeout = FirebaseErrorClassifier.classify(SocketTimeoutException("Connection timed out"))
        assertEquals(ErrorCategory.NETWORK, timeout.category)
        assertTrue(timeout.isRetryable)
    }

    @Test
    fun testFirestorePermissionDeniedClassification() {
        val firestoreDenied = mockk<FirebaseFirestoreException>()
        every { firestoreDenied.code } returns FirebaseFirestoreException.Code.PERMISSION_DENIED
        every { firestoreDenied.message } returns "Permission denied by security rules"

        val classified = FirebaseErrorClassifier.classify(firestoreDenied)
        assertEquals(ErrorCategory.PERMISSION_DENIED, classified.category)
        assertFalse(classified.isRetryable)
    }

    @Test
    fun testFirestoreQuotaExceededClassification() {
        val quotaExceeded = mockk<FirebaseFirestoreException>()
        every { quotaExceeded.code } returns FirebaseFirestoreException.Code.RESOURCE_EXHAUSTED
        every { quotaExceeded.message } returns "Quota exceeded"

        val classified = FirebaseErrorClassifier.classify(quotaExceeded)
        assertEquals(ErrorCategory.QUOTA, classified.category)
        assertFalse(classified.isRetryable)
    }

    @Test
    fun testIOExceptionClassification() {
        val ioException = IOException("USB drive unmounted unexpectedly")
        val classified = FirebaseErrorClassifier.classify(ioException)
        assertEquals(ErrorCategory.SOURCE_UNAVAILABLE, classified.category)
        assertTrue(classified.isRetryable)
    }
}
