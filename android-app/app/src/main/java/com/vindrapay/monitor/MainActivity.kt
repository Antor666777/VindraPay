package com.vindrapay.monitor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.vindrapay.monitor.data.prefs.AppSettings
import com.vindrapay.monitor.service.MonitorRuntimeState
import com.vindrapay.monitor.service.MonitoringService
import com.vindrapay.monitor.ui.components.ConnectionPill
import com.vindrapay.monitor.ui.components.PillState
import com.vindrapay.monitor.ui.nav.Routes
import com.vindrapay.monitor.ui.screens.HistoryScreen
import com.vindrapay.monitor.ui.screens.HomeScreen
import com.vindrapay.monitor.ui.screens.OnboardingScreen
import com.vindrapay.monitor.ui.screens.SettingsScreen
import com.vindrapay.monitor.ui.theme.VindraPayTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as MonitorApp).container
        setContent {
            VindraPayTheme {
                AppRoot(container)
            }
        }
    }
}

@Composable
private fun AppRoot(container: AppContainer) {
    val context = LocalContext.current
    val settings by container.settingsStore.settings.collectAsStateWithLifecycle(AppSettings.DEFAULT)
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showOnboarding = !settings.onboardingDone

    LaunchedEffect(settings.onboardingDone, settings.monitoringEnabled) {
        if (settings.onboardingDone && settings.monitoringEnabled) {
            val token = withContext(Dispatchers.IO) { container.secureTokenStore.token() }
            if (token != null) {
                MonitoringService.start(context)
            }
        }
    }

    val pillState by remember {
        combine(
            MonitorRuntimeState.backendOnline,
            MonitorRuntimeState.lastHeartbeatAtEpoch
        ) { online, lastHeartbeatAt ->
            when {
                lastHeartbeatAt == null -> PillState.WAITING
                online -> PillState.ONLINE
                else -> PillState.OFFLINE
            }
        }
    }.collectAsStateWithLifecycle(PillState.WAITING)

    key(showOnboarding) {
        Scaffold(
            topBar = {
                if (!showOnboarding) {
                    MonitorTopBar(titleFor(currentRoute), pillState)
                }
            },
            bottomBar = {
                if (!showOnboarding) {
                    MonitorBottomBar(navController, currentRoute)
                }
            }
        ) { padding ->
            NavHost(
                navController = navController,
                startDestination = if (showOnboarding) Routes.ONBOARDING else Routes.HOME,
                modifier = Modifier.padding(padding)
            ) {
                composable(Routes.ONBOARDING) { OnboardingScreen(container, navController) }
                composable(Routes.HOME) { HomeScreen(container) }
                composable(Routes.HISTORY) { HistoryScreen(container) }
                composable(Routes.SETTINGS) { SettingsScreen(container) }
            }
        }
    }
}

private fun titleFor(route: String?): String = when (route) {
    Routes.HISTORY -> "History"
    Routes.SETTINGS -> "Settings"
    else -> "VindraPay"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MonitorTopBar(title: String, pillState: PillState) {
    TopAppBar(
        title = { Text(title) },
        actions = {
            ConnectionPill(state = pillState, modifier = Modifier.padding(end = 12.dp))
        }
    )
}

@Composable
private fun MonitorBottomBar(navController: NavHostController, currentRoute: String?) {
    NavigationBar {
        BottomItem(
            navController = navController,
            route = Routes.HOME,
            currentRoute = currentRoute,
            icon = Icons.Filled.Home,
            label = "Home"
        )
        BottomItem(
            navController = navController,
            route = Routes.HISTORY,
            currentRoute = currentRoute,
            icon = Icons.Filled.List,
            label = "History"
        )
        BottomItem(
            navController = navController,
            route = Routes.SETTINGS,
            currentRoute = currentRoute,
            icon = Icons.Filled.Settings,
            label = "Settings"
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RowScope.BottomItem(
    navController: NavHostController,
    route: String,
    currentRoute: String?,
    icon: ImageVector,
    label: String
) {
    NavigationBarItem(
        selected = currentRoute == route,
        onClick = {
            navController.navigate(route) {
                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        },
        icon = { Icon(icon, contentDescription = label) },
        label = { Text(label) }
    )
}
