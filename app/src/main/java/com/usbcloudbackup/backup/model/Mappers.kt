package com.usbcloudbackup.backup.model

import com.usbcloudbackup.database.entity.BackupJobEntity
import com.usbcloudbackup.database.entity.FileEntity
import com.usbcloudbackup.database.entity.NameReservationEntity
import com.usbcloudbackup.database.entity.SourceEntity
import com.usbcloudbackup.database.entity.UploadTaskEntity

fun SourceEntity.toDomain() = UsbSource(
    sourceId = sourceId,
    usbVendorId = usbVendorId,
    usbProductId = usbProductId,
    serialNumber = serialNumber,
    volumeUuid = volumeUuid,
    displayName = displayName,
    firstSeen = firstSeen,
    lastSeen = lastSeen
)

fun UsbSource.toEntity() = SourceEntity(
    sourceId = sourceId,
    usbVendorId = usbVendorId,
    usbProductId = usbProductId,
    serialNumber = serialNumber,
    volumeUuid = volumeUuid,
    displayName = displayName,
    firstSeen = firstSeen,
    lastSeen = lastSeen
)

fun BackupJobEntity.toDomain() = BackupJob(
    jobId = jobId,
    sourceId = sourceId,
    state = state,
    startedAt = startedAt,
    completedAt = completedAt,
    totalFiles = totalFiles,
    uploadedFiles = uploadedFiles,
    skippedFiles = skippedFiles,
    errorFiles = errorFiles
)

fun BackupJob.toEntity() = BackupJobEntity(
    jobId = jobId,
    sourceId = sourceId,
    state = state,
    startedAt = startedAt,
    completedAt = completedAt,
    totalFiles = totalFiles,
    uploadedFiles = uploadedFiles,
    skippedFiles = skippedFiles,
    errorFiles = errorFiles
)

fun FileEntity.toDomain() = BackupFile(
    id = id,
    jobId = jobId,
    sourceId = sourceId,
    relativePath = relativePath,
    originalName = originalName,
    cloudFilename = cloudFilename,
    sha256 = sha256,
    size = size,
    lastModified = lastModified,
    mimeType = mimeType,
    status = status,
    backupMode = backupMode,
    requestStatus = requestStatus,
    extension = extension,
    b2ObjectKey = b2ObjectKey,
    storageBackend = storageBackend,
    retryCount = retryCount,
    errorMessage = errorMessage
)

fun BackupFile.toEntity() = FileEntity(
    id = id,
    jobId = jobId,
    sourceId = sourceId,
    relativePath = relativePath,
    originalName = originalName,
    cloudFilename = cloudFilename,
    sha256 = sha256,
    size = size,
    lastModified = lastModified,
    mimeType = mimeType,
    status = status,
    backupMode = backupMode,
    requestStatus = requestStatus,
    extension = extension,
    b2ObjectKey = b2ObjectKey,
    storageBackend = storageBackend,
    retryCount = retryCount,
    errorMessage = errorMessage
)

fun UploadTaskEntity.toDomain() = UploadTask(
    taskId = taskId,
    fileId = fileId,
    state = state,
    b2ObjectKey = b2ObjectKey,
    uploadSessionUri = uploadSessionUri,
    reservationId = reservationId,
    sha256 = sha256,
    bytesTransferred = bytesTransferred,
    totalBytes = totalBytes,
    updatedAt = updatedAt
)

fun UploadTask.toEntity() = UploadTaskEntity(
    taskId = taskId,
    fileId = fileId,
    state = state,
    b2ObjectKey = b2ObjectKey,
    uploadSessionUri = uploadSessionUri,
    reservationId = reservationId,
    sha256 = sha256,
    bytesTransferred = bytesTransferred,
    totalBytes = totalBytes,
    updatedAt = updatedAt
)

fun NameReservationEntity.toDomain() = NameReservation(
    reservationId = reservationId,
    sha256 = sha256,
    b2ObjectKey = b2ObjectKey,
    sourceId = sourceId,
    relativePath = relativePath,
    originalName = originalName,
    storedName = storedName,
    version = version,
    status = status,
    jobId = jobId,
    ownerTaskId = ownerTaskId,
    createdAt = createdAt,
    expiresAt = expiresAt
)

fun NameReservation.toEntity() = NameReservationEntity(
    reservationId = reservationId,
    sha256 = sha256,
    b2ObjectKey = b2ObjectKey,
    sourceId = sourceId,
    relativePath = relativePath,
    originalName = originalName,
    storedName = storedName,
    version = version,
    status = status,
    jobId = jobId,
    ownerTaskId = ownerTaskId,
    createdAt = createdAt,
    expiresAt = expiresAt
)
