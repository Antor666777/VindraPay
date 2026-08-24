package com.vindrapay.monitor.ui.screens

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.navigation.NavHostController
import com.vindrapay.monitor.AppContainer
import com.vindrapay.monitor.service.MonitoringService
import com.vindrapay.monitor.ui.components.ConnectionSetupCard
import com.vindrapay.monitor.ui.components.OemTipsCard
import com.vindrapay.monitor.ui.nav.Routes
import com.vindrapay.monitor.ui.theme.Amber500
import com.vindrapay.monitor.ui.theme.Green500
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val PAGE_COUNT = 5

@Composable
fun OnboardingScreen(container: AppContainer, navController: NavHostController) {
    val scope = rememberCoroutineScope()
    val pagerState = rememberPagerState(pageCount = { PAGE_COUNT })
    val page = pagerState.currentPage

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("VindraPay Monitor", style = MaterialTheme.typography.headlineMedium)
        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) { pageIndex ->
            when (pageIndex) {
                0 -> WelcomePage()
                1 -> SmsPermissionsPage()
                2 -> BatteryPage()
                3 -> ConnectionPage(container)
                else -> DonePage(container, navController)
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(
                enabled = page > 0,
                onClick = {
                    scope.launch {
                        pagerState.animateScrollToPage(page - 1)
                    }
                }
            ) {
                Text("Back")
            }
            Dots(active = page, count = PAGE_COUNT)
            if (page < PAGE_COUNT - 1) {
                Button(
                    onClick = {
                        scope.launch {
                            pagerState.animateScrollToPage(page + 1)
                        }
                    }
                ) {
                    Text("Next")
                }
            } else {
                Spacer(Modifier.width(64.dp))
            }
        }
    }
}

@Composable
private fun WelcomePage() {
    PageScaffold {
        Text("Turn a spare Android phone into a payment monitor", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Bullet(
            "VindraPay watches incoming SMS from mobile-money providers such as bKash and forwards them to your own backend."
        )
        Bullet("Nothing is sent anywhere except the server URL you configure in the next steps.")
        Bullet("The device token is stored encrypted on this phone.")
        Bullet("You can pause monitoring at any time from the dashboard.")
    }
}

@Composable
private fun SmsPermissionsPage() {
    val context = LocalContext.current
    var results by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { granted ->
        results = granted
    }

    fun granted(permission: String): Boolean =
        results[permission] ?: hasPermission(context, permission)

    val smsRead = granted(Manifest.permission.READ_SMS)
    val smsReceive = granted(Manifest.permission.RECEIVE_SMS)
    val notifications = if (Build.VERSION.SDK_INT >= 33) {
        granted(Manifest.permission.POST_NOTIFICATIONS)
    } else {
        true
    }

    PageScaffold {
        Text("SMS access is required", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Bullet(
            "Read SMS lets VindraPay see message sender and text so it can detect payment confirmations."
        )
        Bullet(
            "VindraPay only forwards messages that match your configured providers, and never shows SMS content in notifications."
        )
        Spacer(Modifier.height(12.dp))
        PermissionRow("READ_SMS", smsRead)
        PermissionRow("RECEIVE_SMS", smsReceive)
        if (Build.VERSION.SDK_INT >= 33) {
            PermissionRow("POST_NOTIFICATIONS", notifications)
        }
        Spacer(Modifier.height(12.dp))
        val wanted = buildList {
            add(Manifest.permission.READ_SMS)
            add(Manifest.permission.RECEIVE_SMS)
            if (Build.VERSION.SDK_INT >= 33) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        Button(onClick = { launcher.launch(wanted.toTypedArray()) }) {
            Text(if (smsRead && smsReceive && notifications) "Re-check permissions" else "Grant permissions")
        }
    }
}

@Composable
private fun BatteryPage() {
    val context = LocalContext.current

    fun requestIgnore() {
        try {
            context.startActivity(
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

    PageScaffold {
        Text("Keep monitoring alive", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Bullet(
            "Android aggressively kills background apps. Excluding VindraPay from battery optimization lets the foreground service keep running for days."
        )
        Bullet(
            "On the next screen choose Allow. VindraPay only sends matched payment SMS to the server you configured."
        )
        Spacer(Modifier.height(12.dp))
        Button(onClick = { requestIgnore() }) {
            Text("Disable battery optimization")
        }
        Spacer(Modifier.height(6.dp))
        OutlinedButton(onClick = {
            try {
                context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (e: Exception) {
            }
        }) {
            Text("Open battery settings list")
        }
        Spacer(Modifier.height(12.dp))
        OemTipsCard()
    }
}

@Composable
private fun ConnectionPage(container: AppContainer) {
    var verified by remember { mutableStateOf(false) }
    PageScaffold {
        Text("Connect to your server", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Point VindraPay at the machine running the VindraPay backend. Use an http:// LAN address while testing.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(12.dp))
        ConnectionSetupCard(
            container = container,
            initialBaseUrl = "",
            hasStoredToken = false,
            onVerificationChanged = { verified = it }
        )
        if (!verified) {
            Spacer(Modifier.height(8.dp))
            Text(
                "The connection test must pass before you finish setup.",
                style = MaterialTheme.typography.labelSmall,
                color = Amber500
            )
        }
    }
}

@Composable
private fun DonePage(container: AppContainer, navController: NavHostController) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var starting by remember { mutableStateOf(false) }

    PageScaffold {
        Icon(
            imageVector = Icons.Filled.CheckCircle,
            contentDescription = null,
            tint = Green500,
            modifier = Modifier.size(56.dp)
        )
        Spacer(Modifier.height(8.dp))
        Text("Setup complete", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Bullet("Permissions requested")
        Bullet("Battery optimization explained")
        Bullet("Server connection configured")
        Spacer(Modifier.height(12.dp))
        error?.let { message ->
            Text(message, color = Amber500, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
        }
        Button(
            enabled = !starting,
            onClick = {
                scope.launch {
                    starting = true
                    error = null
                    val token = withContext(Dispatchers.IO) { container.secureTokenStore.token() }
                    if (token == null) {
                        error = "No device token saved yet — go back one step and save your token."
                        starting = false
                        return@launch
                    }
                    container.settingsStore.setOnboardingDone(true)
                    container.settingsStore.setMonitoringEnabled(true)
                    MonitoringService.start(context)
                    navController.navigate(Routes.HOME) {
                        popUpTo(Routes.ONBOARDING) { inclusive = true }
                        launchSingleTop = true
                    }
                }
            }
        ) {
            Text(if (starting) "Starting…" else "Start monitoring")
        }
    }
}

@Composable
private fun PageScaffold(content: @Composable () -> Unit) {
    val screenHeight = LocalConfiguration.current.screenHeightDp
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = screenHeight.dp)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        content()
    }
}

@Composable
private fun Bullet(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            modifier = Modifier
                .padding(top = 7.dp)
                .size(6.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
        )
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun PermissionRow(name: String, granted: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(
            imageVector = if (granted) Icons.Filled.CheckCircle else Icons.Filled.Warning,
            contentDescription = null,
            tint = if (granted) Green500 else Amber500,
            modifier = Modifier.size(18.dp)
        )
        Text(name, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun Dots(active: Int, count: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(count) { index ->
            val color = if (index == active) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            }
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(color)
            )
        }
    }
}

private fun hasPermission(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
