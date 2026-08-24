package com.vindrapay.monitor.data.prefs

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.vindraDataStore by preferencesDataStore(name = "vindrapay_settings")

data class AppSettings(
    val baseUrl: String,
    val heartbeatIntervalSeconds: Int,
    val notificationsEnabled: Boolean,
    val monitoringEnabled: Boolean,
    val onboardingDone: Boolean
) {
    companion object {
        const val MIN_HEARTBEAT_INTERVAL_SECONDS = 15
        const val MAX_HEARTBEAT_INTERVAL_SECONDS = 300
        const val DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30
        val DEFAULT = AppSettings(
            baseUrl = "",
            heartbeatIntervalSeconds = DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
            notificationsEnabled = true,
            monitoringEnabled = false,
            onboardingDone = false
        )
    }
}

class SettingsStore(private val context: Context) {

    private object Keys {
        val BASE_URL = stringPreferencesKey("base_url")
        val HEARTBEAT_INTERVAL_SECONDS = intPreferencesKey("heartbeat_interval_seconds")
        val NOTIFICATIONS_ENABLED = booleanPreferencesKey("notifications_enabled")
        val MONITORING_ENABLED = booleanPreferencesKey("monitoring_enabled")
        val ONBOARDING_DONE = booleanPreferencesKey("onboarding_done")
    }

    val settings: Flow<AppSettings> = context.vindraDataStore.data.map { prefs ->
        AppSettings(
            baseUrl = prefs[Keys.BASE_URL] ?: "",
            heartbeatIntervalSeconds = prefs[Keys.HEARTBEAT_INTERVAL_SECONDS]
                ?: AppSettings.DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
            notificationsEnabled = prefs[Keys.NOTIFICATIONS_ENABLED] ?: true,
            monitoringEnabled = prefs[Keys.MONITORING_ENABLED] ?: false,
            onboardingDone = prefs[Keys.ONBOARDING_DONE] ?: false
        )
    }

    suspend fun setBaseUrl(value: String) {
        context.vindraDataStore.edit { it[Keys.BASE_URL] = value }
    }

    suspend fun setHeartbeatIntervalSeconds(value: Int) {
        context.vindraDataStore.edit { it[Keys.HEARTBEAT_INTERVAL_SECONDS] = value }
    }

    suspend fun setNotificationsEnabled(value: Boolean) {
        context.vindraDataStore.edit { it[Keys.NOTIFICATIONS_ENABLED] = value }
    }

    suspend fun setMonitoringEnabled(value: Boolean) {
        context.vindraDataStore.edit { it[Keys.MONITORING_ENABLED] = value }
    }

    suspend fun setOnboardingDone(value: Boolean) {
        context.vindraDataStore.edit { it[Keys.ONBOARDING_DONE] = value }
    }
}
