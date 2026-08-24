package com.vindrapay.monitor.ui.components

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vindrapay.monitor.ui.theme.Amber500
import com.vindrapay.monitor.ui.theme.Green500
import java.util.Locale

@Composable
fun PermissionCard(
    title: String,
    description: String,
    resolved: Boolean,
    resolvedLabel: String = "Done",
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    ElevatedCard(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    imageVector = if (resolved) Icons.Filled.CheckCircle else Icons.Filled.Warning,
                    contentDescription = null,
                    tint = if (resolved) Green500 else Amber500,
                    modifier = Modifier.size(20.dp)
                )
                Text(title, style = MaterialTheme.typography.titleMedium)
            }
            Text(
                description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (!resolved && actionLabel != null && onAction != null) {
                Spacer(Modifier.height(2.dp))
                FilledTonalButton(onClick = onAction) {
                    Text(actionLabel)
                }
            } else if (resolved) {
                Spacer(Modifier.height(2.dp))
                Text(
                    resolvedLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = Green500
                )
            }
        }
    }
}

private val OEM_TIPS = mapOf(
    "xiaomi" to "MIUI: open the Security app, enable Autostart for VindraPay, set Battery saver to No restrictions, and lock the app in Recents so MIUI does not kill it.",
    "oppo" to "ColorOS: Settings > Battery > More settings, allow VindraPay to run in the background, enable Auto-start, and disable Deep sleep optimization for the app.",
    "realme" to "Realme UI: enable Auto-start for VindraPay, set its battery usage to Allow background activity, and lock it in Recents.",
    "vivo" to "Funtouch OS: Settings > Battery > Background power consumption management, choose Allow high background power consumption for VindraPay and enable Auto-start.",
    "huawei" to "EMUI: Settings > Battery > App launch, select VindraPay, turn off Manage automatically and enable all three manual controls (auto-launch, secondary launch, run in background).",
    "honor" to "MagicOS: Settings > Battery > App launch, select VindraPay, switch to Manage manually and allow background running.",
    "oneplus" to "OxygenOS: Settings > Battery > Battery optimization, set VindraPay to Don't optimize so the monitoring service is not killed."
)

fun oemTipFor(manufacturer: String): String? {
    val brand = manufacturer.lowercase(Locale.US)
    for ((key, tip) in OEM_TIPS) {
        if (brand.contains(key)) return tip
    }
    return null
}

@Composable
fun OemTipsCard(modifier: Modifier = Modifier) {
    val tip = oemTipFor(Build.MANUFACTURER) ?: return
    ElevatedCard(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    imageVector = Icons.Filled.Warning,
                    contentDescription = null,
                    tint = Amber500,
                    modifier = Modifier.size(20.dp)
                )
                Text("Battery tips for this device", style = MaterialTheme.typography.titleMedium)
            }
            Text(
                tip,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
