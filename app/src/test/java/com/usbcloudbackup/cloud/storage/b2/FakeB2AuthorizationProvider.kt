package com.usbcloudbackup.cloud.storage.b2

class FakeB2AuthorizationProvider(
    var mockEndpoint: String = "https://s3.eu-central-003.backblazeb2.com/BrightCloud"
) : B2AuthorizationProvider {

    var lastRequestedUploadKey: String? = null
    var lastRequestedHeadKey: String? = null
    var lastRequestedDeleteKey: String? = null
    var shouldFail: Boolean = false

    override suspend fun getUploadAuthorization(
        uid: String,
        objectKey: String,
        sha256: String,
        sourceId: String,
        originalName: String,
        fileId: String
    ): B2UploadAuthorization {
        if (shouldFail) {
            throw SecurityException("Unauthorized B2 upload request")
        }
        lastRequestedUploadKey = objectKey
        val headers = mapOf(
            "x-amz-meta-sha256" to sha256,
            "x-amz-meta-source-id" to sourceId,
            "x-amz-meta-original-name" to originalName,
            "x-amz-meta-file-id" to fileId
        )
        return B2UploadAuthorization(
            uploadUrl = "$mockEndpoint/$objectKey?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=mock_sig_${System.currentTimeMillis()}",
            headers = headers,
            expiresAt = System.currentTimeMillis() + 3600_000L
        )
    }

    override suspend fun getHeadAuthorization(
        uid: String,
        objectKey: String
    ): B2HeadAuthorization {
        if (shouldFail) {
            throw SecurityException("Unauthorized B2 HEAD request")
        }
        lastRequestedHeadKey = objectKey
        return B2HeadAuthorization(
            headUrl = "$mockEndpoint/$objectKey?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=mock_head_sig_${System.currentTimeMillis()}",
            headers = emptyMap(),
            expiresAt = System.currentTimeMillis() + 3600_000L
        )
    }

    override suspend fun getDeleteAuthorization(
        uid: String,
        objectKey: String
    ): B2DeleteAuthorization {
        if (shouldFail) {
            throw SecurityException("Unauthorized B2 DELETE request")
        }
        lastRequestedDeleteKey = objectKey
        return B2DeleteAuthorization(
            deleteUrl = "$mockEndpoint/$objectKey?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=mock_delete_sig_${System.currentTimeMillis()}",
            expiresAt = System.currentTimeMillis() + 3600_000L
        )
    }
}
