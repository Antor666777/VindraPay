package com.vindrapay.monitor

import android.app.Application
import android.content.Context
import com.vindrapay.monitor.data.local.AppDatabase
import com.vindrapay.monitor.data.prefs.SecureTokenStore
import com.vindrapay.monitor.data.prefs.SettingsStore
import com.vindrapay.monitor.data.remote.ApiClient
import com.vindrapay.monitor.data.remote.NetworkConfig
import com.vindrapay.monitor.data.repo.CaptureRepository
import com.vindrapay.monitor.util.ConnectivityObserver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MonitorApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.applicationScope.launch {
            container.settingsStore.settings.collect { NetworkConfig.baseUrl = it.baseUrl }
        }
        container.connectivityObserver.start()
    }
}

class AppContainer(context: Context) {

    val applicationContext: Context = context.applicationContext
    val applicationScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val settingsStore: SettingsStore by lazy { SettingsStore(applicationContext) }
    val secureTokenStore: SecureTokenStore by lazy { SecureTokenStore(applicationContext) }
    val connectivityObserver: ConnectivityObserver by lazy { ConnectivityObserver(applicationContext) }
    val apiClient: ApiClient by lazy { ApiClient { secureTokenStore.token() } }

    private val database: AppDatabase by lazy { AppDatabase.build(applicationContext) }

    val captureRepository: CaptureRepository by lazy {
        CaptureRepository(
            context = applicationContext,
            database = database,
            apiClient = apiClient,
            settingsStore = settingsStore,
            connectivityObserver = connectivityObserver
        )
    }
}
