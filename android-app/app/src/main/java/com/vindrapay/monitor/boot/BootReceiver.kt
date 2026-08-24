package com.vindrapay.monitor.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.vindrapay.monitor.MonitorApp
import com.vindrapay.monitor.service.MonitoringService
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext as? MonitorApp ?: return
        val container = app.container
        container.applicationScope.launch {
            try {
                val settings = container.settingsStore.settings.first()
                val token = container.secureTokenStore.token()
                if (settings.onboardingDone && settings.monitoringEnabled && token != null) {
                    MonitoringService.start(context)
                }
            } catch (e: Exception) {
            }
        }
    }
}
