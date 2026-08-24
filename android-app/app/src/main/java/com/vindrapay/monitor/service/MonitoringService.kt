package com.vindrapay.monitor.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.vindrapay.monitor.MonitorApp
import com.vindrapay.monitor.R
import com.vindrapay.monitor.data.repo.HeartbeatResult
import com.vindrapay.monitor.work.UploadWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

object MonitorRuntimeState {
    val monitoringActive = MutableStateFlow(false)
    val backendOnline = MutableStateFlow(false)
    val lastHeartbeatAtEpoch = MutableStateFlow<Long?>(null)
    val lastHeartbeatError = MutableStateFlow<String?>(null)
}

class MonitoringService : LifecycleService() {

    private val container by lazy { (applicationContext as MonitorApp).container }

    private var heartbeatJob: Job? = null
    private var connectivityJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        startInForeground()
        MonitorRuntimeState.monitoringActive.value = true
        heartbeatJob = lifecycleScope.launch(Dispatchers.Default) { heartbeatLoop() }
        connectivityJob = lifecycleScope.launch { watchConnectivity() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        return START_STICKY
    }

    override fun onDestroy() {
        MonitorRuntimeState.monitoringActive.value = false
        MonitorRuntimeState.backendOnline.value = false
        heartbeatJob?.cancel()
        connectivityJob?.cancel()
        super.onDestroy()
    }

    private suspend fun heartbeatLoop() {
        while (currentCoroutineContext().isActive) {
            runHeartbeatCycle()
            val settings = container.settingsStore.settings.first()
            val intervalSeconds = settings.heartbeatIntervalSeconds
                .coerceIn(MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS)
            delay(intervalSeconds * 1000L)
        }
    }

    private suspend fun runHeartbeatCycle() {
        when (val result = container.captureRepository.heartbeat()) {
            is HeartbeatResult.Success -> {
                MonitorRuntimeState.backendOnline.value = true
                MonitorRuntimeState.lastHeartbeatAtEpoch.value = System.currentTimeMillis()
                MonitorRuntimeState.lastHeartbeatError.value = null
                if (container.captureRepository.pendingCount() > 0 &&
                    container.connectivityObserver.isOnline.value
                ) {
                    UploadWorker.enqueue(applicationContext)
                }
            }

            is HeartbeatResult.Unauthorized -> {
                MonitorRuntimeState.backendOnline.value = false
                MonitorRuntimeState.lastHeartbeatError.value = "Device token rejected"
            }

            is HeartbeatResult.Failure -> {
                MonitorRuntimeState.backendOnline.value = false
                MonitorRuntimeState.lastHeartbeatError.value =
                    result.message ?: "Backend unreachable"
            }
        }
    }

    private suspend fun watchConnectivity() {
        container.connectivityObserver.isOnline.collect { online ->
            if (online && container.captureRepository.pendingCount() > 0) {
                UploadWorker.enqueue(applicationContext)
            }
        }
    }

    private fun startInForeground() {
        ensureChannel()
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "VindraPay monitoring", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Silent indicator that payment monitoring is active"
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("VindraPay is monitoring for payments")
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

    companion object {
        const val CHANNEL_ID = "monitoring"
        const val NOTIFICATION_ID = 1001
        const val MIN_INTERVAL_SECONDS = 15
        const val MAX_INTERVAL_SECONDS = 300

        fun start(context: Context) {
            val intent = Intent(context, MonitoringService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MonitoringService::class.java))
        }
    }
}
