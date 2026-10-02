package com.usbcloudbackup.cloud.firestore

import com.usbcloudbackup.backup.ReservedNameResult
import com.usbcloudbackup.backup.model.BackupFile
import com.usbcloudbackup.backup.model.BackupJob
import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.config.VaultConfig

interface FirestoreRepository {
    suspend fun saveSource(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        source: UsbSource
    )

    suspend fun isContentHashIndexed(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        sha256: String
    ): Boolean

    suspend fun reserveCloudFilename(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        sourceId: String,
        relativePath: String,
        originalName: String,
        sha256: String,
        jobId: String,
        ownerTaskId: String
    ): ReservedNameResult

    suspend fun finalizeUploadTransaction(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        file: BackupFile,
        storedName: String,
        b2ObjectKey: String,
        reservationId: String,
        jobId: String,
        storageRepository: com.usbcloudbackup.cloud.storage.CloudStorageRepository? = null,
        pendingDeletionStore: com.usbcloudbackup.cloud.storage.b2.IPendingDeletionStore? = null
    ): String

    suspend fun indexMetadataOnlyFile(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        file: BackupFile,
        jobId: String
    ): String

    suspend fun updateBackupJobState(
        vaultId: String = VaultConfig.DEFAULT_VAULT_ID,
        job: BackupJob
    )
}
