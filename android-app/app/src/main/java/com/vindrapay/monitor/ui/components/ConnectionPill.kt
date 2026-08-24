package com.vindrapay.monitor.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.vindrapay.monitor.AppContainer
import com.vindrapay.monitor.data.remote.NetworkConfig
import com.vindrapay.monitor.data.repo.HeartbeatResult
import com.vindrapay.monitor.ui.theme.Amber500
import com.vindrapay.monitor.ui.theme.Green500
import com.vindrapay.monitor.ui.theme.Red500
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class PillState { WAITING, ONLINE, OFFLINE }

@Composable
fun ConnectionPill(state: PillState, modifier: Modifier = Modifier) {
    val accent = when (state) {
        PillState.WAITING -> Amber500
        PillState.ONLINE -> Green500
        PillState.OFFLINE -> Red500
    }
    val label = when (state) {
        PillState.WAITING -> "Waiting"
        PillState.ONLINE -> "Online"
        PillState.OFFLINE -> "Offline"
    }
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = accent.copy(alpha = 0.15f),
        contentColor = accent,
        border = BorderStroke(1.dp, accent.copy(alpha = 0.4f))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(accent)
                    .size(8.dp)
            )
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

enum class CheckState { PENDING, RUNNING, PASSED, FAILED }

fun normalizeBaseUrl(raw: String): String? {
    val cleaned = raw.trim().trimEnd('/')
    if (cleaned.contains(' ') || cleaned.contains('\t') || cleaned.contains('\n')) return null
    val schemeOk = cleaned.startsWith("http://") || cleaned.startsWith("https://")
    val rest = cleaned.removePrefix("http://").removePrefix("https://")
    return if (schemeOk && rest.isNotBlank()) cleaned else null
}

@Composable
fun ConnectionSetupCard(
    container: AppContainer,
    initialBaseUrl: String,
    hasStoredToken: Boolean,
    onVerificationChanged: (Boolean) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    var baseUrl by remember { mutableStateOf(initialBaseUrl) }
    var tokenInput by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var urlError by remember { mutableStateOf<String?>(null) }
    var reachableState by remember { mutableStateOf(CheckState.PENDING) }
    var reachableDetail by remember { mutableStateOf<String?>(null) }
    var authState by remember { mutableStateOf(CheckState.PENDING) }
    var authDetail by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = modifier
            .fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        OutlinedTextField(
            value = baseUrl,
            onValueChange = { value ->
                baseUrl = value
                urlError = null
            },
            label = { Text("Server base URL") },
            placeholder = { Text("http://192.168.1.10:8080") },
            supportingText = { Text("Example: http://192.168.1.10:8080") },
            isError = urlError != null,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth()
        )
        urlError?.let { message ->
            Text(message, style = MaterialTheme.typography.labelSmall, color = Red500)
        }
        OutlinedTextField(
            value = tokenInput,
            onValueChange = { tokenInput = it },
            label = { Text(if (hasStoredToken) "Replace device token" else "Device token") },
            placeholder = {
                Text(if (hasStoredToken) "Leave blank to keep current" else "vdt_…")
            },
            supportingText = {
                Text(
                    if (hasStoredToken) "A token is stored securely. Paste a new one only to replace it."
                    else "Paste the device token from your VindraPay admin."
                )
            },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Button(
            enabled = !busy,
            onClick = {
                scope.launch {
                    busy = true
                    urlError = null
                    val normalized = normalizeBaseUrl(baseUrl)
                    if (normalized == null) {
                        urlError = "Enter a valid http(s) URL"
                        busy = false
                        return@launch
                    }
                    baseUrl = normalized
                    NetworkConfig.baseUrl = normalized
                    container.settingsStore.setBaseUrl(normalized)
                    if (tokenInput.isNotBlank()) {
                        val token = tokenInput
                        withContext(Dispatchers.IO) { container.secureTokenStore.saveToken(token) }
                    }
                    reachableState = CheckState.RUNNING
                    reachableDetail = null
                    authState = CheckState.PENDING
                    authDetail = null
                    onVerificationChanged(false)

                    val code = container.captureRepository.pingHealthz()
                    if (code == null) {
                        reachableState = CheckState.FAILED
                        reachableDetail = "Unreachable"
                        authState = CheckState.FAILED
                        authDetail = "Skipped"
                        busy = false
                        return@launch
                    }
                    if (code !in 200..299) {
                        reachableState = CheckState.FAILED
                        reachableDetail = "HTTP $code"
                        authState = CheckState.FAILED
                        authDetail = "Skipped"
                        busy = false
                        return@launch
                    }
                    reachableState = CheckState.PASSED
                    reachableDetail = "HTTP $code"

                    authState = CheckState.RUNNING
                    when (val heartbeat = container.captureRepository.heartbeat()) {
                        is HeartbeatResult.Success -> {
                            authState = CheckState.PASSED
                            authDetail = "${heartbeat.providers.size} provider(s) synced"
                            onVerificationChanged(true)
                        }

                        HeartbeatResult.Unauthorized -> {
                            authState = CheckState.FAILED
                            authDetail = "Rejected — check the device token"
                        }

                        is HeartbeatResult.Failure -> {
                            authState = CheckState.FAILED
                            authDetail = heartbeat.message ?: "Request failed"
                        }
                    }
                    busy = false
                }
            }
        ) {
            Text(if (busy) "Testing…" else "Save & test connection")
        }
        CheckRow("Server reachable", reachableState, reachableDetail)
        CheckRow("Device authorized", authState, authDetail)
    }
}

@Composable
private fun CheckRow(label: String, state: CheckState, detail: String?) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        when (state) {
            CheckState.PENDING -> Box(
                modifier = Modifier
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
            )

            CheckState.RUNNING -> CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = Amber500
            )

            CheckState.PASSED -> Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = Green500,
                modifier = Modifier.size(20.dp)
            )

            CheckState.FAILED -> Icon(
                imageVector = Icons.Filled.Warning,
                contentDescription = null,
                tint = Red500,
                modifier = Modifier.size(20.dp)
            )
        }
        Column {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            detail?.let { text ->
                Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
