package com.vindrapay.monitor.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vindrapay.monitor.AppContainer
import com.vindrapay.monitor.BuildConfig
import com.vindrapay.monitor.data.prefs.AppSettings
import com.vindrapay.monitor.ui.components.ConnectionSetupCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    val settings by container.settingsStore.settings.collectAsStateWithLifecycle(AppSettings.DEFAULT)

    var hasStoredToken by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        hasStoredToken = withContext(Dispatchers.IO) { container.secureTokenStore.token() != null }
    }

    var interval by remember(settings.heartbeatIntervalSeconds) {
        mutableFloatStateOf(settings.heartbeatIntervalSeconds.toFloat())
    }
    var notificationsEnabled by remember(settings.notificationsEnabled) {
        mutableStateOf(settings.notificationsEnabled)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Connection", style = MaterialTheme.typography.titleMedium)
        ConnectionSetupCard(
            container = container,
            initialBaseUrl = settings.baseUrl,
            hasStoredToken = hasStoredToken,
            onVerificationChanged = { verified ->
                if (verified) {
                    hasStoredToken = true
                }
            }
        )

        Text("Heartbeat", style = MaterialTheme.typography.titleMedium)
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Interval", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "${interval.toInt()} s",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Slider(
                    value = interval,
                    onValueChange = { interval = it },
                    valueRange = AppSettings.MIN_HEARTBEAT_INTERVAL_SECONDS.toFloat()..
                        AppSettings.MAX_HEARTBEAT_INTERVAL_SECONDS.toFloat(),
                    steps = (AppSettings.MAX_HEARTBEAT_INTERVAL_SECONDS -
                        AppSettings.MIN_HEARTBEAT_INTERVAL_SECONDS) / 5 - 1,
                    onValueChangeFinished = {
                        scope.launch {
                            container.settingsStore.setHeartbeatIntervalSeconds(interval.toInt())
                        }
                    }
                )
                Text(
                    "How often the app heartbeats and re-syncs providers (15–300 s, step 5).",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        Text("Notifications", style = MaterialTheme.typography.titleMedium)
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .padding(14.dp)
                    .fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Per-message updates", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Delivery status for each captured payment SMS.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(
                    checked = notificationsEnabled,
                    onCheckedChange = { enabled ->
                        notificationsEnabled = enabled
                        scope.launch {
                            container.settingsStore.setNotificationsEnabled(enabled)
                        }
                    }
                )
            }
        }

        Text("About", style = MaterialTheme.typography.titleMedium)
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .padding(14.dp)
                    .fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Version", style = MaterialTheme.typography.bodyMedium)
                Text(
                    BuildConfig.VERSION_NAME,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}
