package com.usbcloudbackup.backup.repository

import com.usbcloudbackup.backup.model.UsbSource
import com.usbcloudbackup.backup.model.toDomain
import com.usbcloudbackup.backup.model.toEntity
import com.usbcloudbackup.database.dao.SourceDao
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class SourceRepository(private val sourceDao: SourceDao) {

    suspend fun saveSource(source: UsbSource) {
        sourceDao.insertSource(source.toEntity())
    }

    suspend fun getSource(sourceId: String): UsbSource? {
        return sourceDao.getSourceById(sourceId)?.toDomain()
    }

    fun observeSource(sourceId: String): Flow<UsbSource?> {
        return sourceDao.observeSourceById(sourceId).map { it?.toDomain() }
    }

    suspend fun getAllSources(): List<UsbSource> {
        return sourceDao.getAllSources().map { it.toDomain() }
    }
}
