package com.vindrapay.monitor.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vindrapay.monitor.AppContainer
import com.vindrapay.monitor.data.local.CapturedSmsEntity
import com.vindrapay.monitor.ui.components.ChipTone
import com.vindrapay.monitor.ui.components.StatusChip
import com.vindrapay.monitor.ui.components.chipToneForStatus
import com.vindrapay.monitor.work.UploadWorker
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val displayFormat = SimpleDateFormat("EEE, MMM d · HH:mm", Locale.getDefault())

@Composable
fun HistoryScreen(container: AppContainer) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    val items by container.captureRepository.observeRecent(200).collectAsStateWithLifecycle(emptyList())
    val pending by container.captureRepository.observePendingCount().collectAsStateWithLifecycle(0)

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Captured messages", style = MaterialTheme.typography.titleMedium)
                FilledTonalButton(
                    enabled = pending > 0,
                    onClick = {
                        scope.launch {
                            UploadWorker.enqueue(context)
                            snackbarHostState.showSnackbar("Retrying $pending pending message(s)…")
                        }
                    }
                ) {
                    Icon(Icons.Filled.Refresh, contentDescription = null)
                    Text("  Retry pending")
                }
            }
            if (items.isEmpty()) {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        "Nothing captured yet. Payment SMS matching your providers will appear here.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(items, key = { it.id }) { entry ->
                        HistoryRow(entry)
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoryRow(entry: CapturedSmsEntity) {
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(entry.sender, style = MaterialTheme.typography.titleMedium)
                StatusChip(entry.status, chipToneForStatus(entry.status))
            }
            Text(
                displayFormat.format(Date(entry.receivedAtEpoch)),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            entry.resultStatus?.let { resultStatus ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    StatusChip(resultStatus, chipToneForStatus(resultStatus))
                    entry.resultReason?.let { reason ->
                        Text(
                            reason,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}
