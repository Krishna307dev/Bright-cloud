package com.usbcloudbackup.receivers

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BootReceiverTest {

    private lateinit var context: Context

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }

    @Test
    fun testBootCompletedEnqueuesReconciliation() {
        val receiver = BootReceiver()
        val intent = Intent(Intent.ACTION_BOOT_COMPLETED)
        receiver.onReceive(context, intent)

        // Verify WorkManager has scheduled work
        val workInfos = WorkManager.getInstance(context).getWorkInfosForUniqueWork("onetime_reconciliation").get()
        assert(workInfos.isNotEmpty())
    }

    @Test
    fun testMyPackageReplacedEnqueuesReconciliation() {
        val receiver = BootReceiver()
        val intent = Intent(Intent.ACTION_MY_PACKAGE_REPLACED)
        receiver.onReceive(context, intent)

        val workInfos = WorkManager.getInstance(context).getWorkInfosForUniqueWork("onetime_reconciliation").get()
        assert(workInfos.isNotEmpty())
    }

    @Test
    fun testUnrelatedActionIgnored() {
        val receiver = BootReceiver()
        val intent = Intent(Intent.ACTION_AIRPLANE_MODE_CHANGED)
        receiver.onReceive(context, intent)

        val workInfos = WorkManager.getInstance(context).getWorkInfosForUniqueWork("onetime_reconciliation").get()
        assert(workInfos.isEmpty())
    }
}
