package com.vindrapay.monitor.ui.screens

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vindrapay.monitor.AppContainer
import com.vindrapay.monitor.data.prefs.AppSettings
import com.vindrapay.monitor.service.MonitorRuntimeState
import com.vindrapay.monitor.service.MonitoringService
import com.vindrapay.monitor.ui.components.OemTipsCard
import com.vindrapay.monitor.ui.components.PermissionCard
import com.vindrapay.monitor.ui.components.ProviderChips
import com.vindrapay.monitor.ui.theme.Amber500
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun HomeScreen(container: AppContainer) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val settings by container.settingsStore.settings.collectAsStateWithLifecycle(AppSettings.DEFAULT)
    val providers by container.captureRepository.observeProviders().collectAsStateWithLifecycle(emptyList())
    val pending by container.captureRepository.observePendingCount().collectAsStateWithLifecycle(0)
    val uploaded by container.captureRepository.observeSentCount().collectAsStateWithLifecycle(0)
    val active by MonitorRuntimeState.monitoringActive.collectAsStateWithLifecycle(false)
    val backendOnline by MonitorRuntimeState.backendOnline.collectAsStateWithLifecycle(false)
    val lastHeartbeatAt by MonitorRuntimeState.lastHeartbeatAtEpoch.collectAsStateWithLifecycle(null)
    val heartbeatError by MonitorRuntimeState.lastHeartbeatError.collectAsStateWithLifecycle(null)

    var refreshTick by remember { mutableIntStateOf(0) }
    val powerManager = remember { context.getSystemService(Context.POWER_SERVICE) as? PowerManager }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { refreshTick++ }

    val batteryLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { refreshTick++ }

    val smsGranted = remember(refreshTick) {
        hasPermission(context, Manifest.permission.RECEIVE_SMS) &&
            hasPermission(context, Manifest.permission.READ_SMS)
    }
    val notificationsGranted = remember(refreshTick) {
        Build.VERSION.SDK_INT < 33 || hasPermission(context, Manifest.permission.POST_NOTIFICATIONS)
    }
    val batteryExempt = remember(refreshTick) {
        powerManager?.isIgnoringBatteryOptimizations(context.packageName) == true
    }

    fun toggleMonitoring(enable: Boolean) {
        scope.launch {
            if (enable) {
                if (!settings.onboardingDone || settings.baseUrl.isBlank()) return@launch
                val token = withContext(Dispatchers.IO) { container.secureTokenStore.token() }
                if (token == null) return@launch
                container.settingsStore.setMonitoringEnabled(true)
                MonitoringService.start(context)
            } else {
                container.settingsStore.setMonitoringEnabled(false)
                MonitoringService.stop(context)
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .padding(16.dp)
                    .fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Payment monitoring", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (active) "Running — watching for payment SMS" else "Paused",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(
                    checked = active,
                    onCheckedChange = { enable -> toggleMonitoring(enable) }
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard("Pending", pending.toString(), Modifier.weight(1f))
            StatCard("Uploaded", uploaded.toString(), Modifier.weight(1f))
        }

        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text("Backend", style = MaterialTheme.typography.titleMedium)
                Text(
                    when {
                        lastHeartbeatAt == null -> "Waiting for first heartbeat…"
                        backendOnline -> "Last heartbeat ${formatAgo(lastHeartbeatAt)}"
                        else -> "Offline — ${heartbeatError ?: "no recent heartbeat"}"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Monitoring for:", style = MaterialTheme.typography.titleMedium)
            if (providers.isEmpty()) {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        "Waiting for provider list — the app drops incoming SMS until a successful heartbeat syncs your providers.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Amber500,
                        modifier = Modifier.padding(14.dp)
                    )
                }
            } else {
                ProviderChips(
                    labels = providers.map { provider ->
                        if (provider.senderId.isNullOrBlank()) provider.name
                        else "${provider.name} · ${provider.senderId}"
                    }
                )
            }
        }

        PermissionCard(
            title = "SMS permissions",
            description = "READ_SMS and RECEIVE_SMS are required to capture provider messages.",
            resolved = smsGranted,
            actionLabel = "Grant SMS permissions",
            onAction = {
                permissionLauncher.launch(
                    arrayOf(
                        Manifest.permission.READ_SMS,
                        Manifest.permission.RECEIVE_SMS
                    )
                )
            }
        )
        if (Build.VERSION.SDK_INT >= 33) {
            PermissionCard(
                title = "Notifications",
                description = "Shows per-message delivery updates. Message bodies are never displayed.",
                resolved = notificationsGranted,
                actionLabel = "Allow notifications",
                onAction = {
                    permissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                }
            )
        }
        PermissionCard(
            title = "Battery optimization",
            description = "Exempt VindraPay so Android does not kill the monitoring service.",
            resolved = batteryExempt,
            actionLabel = "Disable optimization",
            onAction = {
                try {
                    batteryLauncher.launch(
                        Intent(
                            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                            Uri.parse("package:${context.packageName}")
                        )
                    )
                } catch (e: ActivityNotFoundException) {
                    try {
                        context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    } catch (e2: Exception) {
                    }
                } catch (e: Exception) {
                }
            }
        )

        OemTipsCard()
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    ElevatedCard(modifier = modifier) {
        Column(
            modifier = Modifier.padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(value, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

private fun formatAgo(epochMillis: Long?): String {
    if (epochMillis == null) return "never"
    val seconds = (System.currentTimeMillis() - epochMillis) / 1000
    return when {
        seconds < 5 -> "just now"
        seconds < 60 -> "${seconds}s ago"
        seconds < 3600 -> "${seconds / 60}m ago"
        else -> "${seconds / 3600}h ago"
    }
}

private fun hasPermission(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
