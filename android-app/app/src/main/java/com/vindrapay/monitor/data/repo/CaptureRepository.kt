package com.vindrapay.monitor.data.repo

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.room.withTransaction
import com.vindrapay.monitor.BuildConfig
import com.vindrapay.monitor.R
import com.vindrapay.monitor.data.local.AppDatabase
import com.vindrapay.monitor.data.local.CapturedSmsEntity
import com.vindrapay.monitor.data.local.ProviderSyncEntity
import com.vindrapay.monitor.data.prefs.SettingsStore
import com.vindrapay.monitor.data.remote.ApiClient
import com.vindrapay.monitor.data.remote.HeartbeatRequest
import com.vindrapay.monitor.data.remote.MessageResultDto
import com.vindrapay.monitor.data.remote.MessagesRequest
import com.vindrapay.monitor.data.remote.OutgoingMessageDto
import com.vindrapay.monitor.data.remote.ProviderDto
import com.vindrapay.monitor.util.Batch
import com.vindrapay.monitor.util.ConnectivityObserver
import com.vindrapay.monitor.util.Dedup
import com.vindrapay.monitor.work.UploadWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

data class IncomingSms(
    val sender: String,
    val body: String,
    val receivedAtEpochMillis: Long
)

enum class CaptureDecision {
    CAPTURED,
    DUPLICATE_IGNORED,
    DROPPED_NO_PROVIDERS,
    DROPPED_UNMATCHED_SENDER
}

enum class UploadOutcome {
    BATCH_COMPLETED,
    ALL_CAUGHT_UP,
    RETRYABLE_FAILURE,
    FATAL_FAILURE
}

sealed interface HeartbeatResult {
    data class Success(val providers: List<ProviderDto>) : HeartbeatResult
    data object Unauthorized : HeartbeatResult
    data class Failure(val message: String?) : HeartbeatResult
}

class CaptureRepository(
    private val context: Context,
    private val database: AppDatabase,
    private val apiClient: ApiClient,
    private val settingsStore: SettingsStore,
    private val connectivityObserver: ConnectivityObserver
) {

    private val captureDao get() = database.captureDao()
    private val providerDao get() = database.providerDao()

    fun observeProviders(): Flow<List<ProviderSyncEntity>> = providerDao.observeAll()

    fun observeRecent(limit: Int): Flow<List<CapturedSmsEntity>> = captureDao.observeRecent(limit)

    fun observePendingCount(): Flow<Int> = captureDao.observePendingCount()

    fun observeSentCount(): Flow<Int> = captureDao.observeSentCount()

    suspend fun pendingCount(): Int = captureDao.pendingCount()

    suspend fun replaceProviders(providers: List<ProviderDto>) {
        val now = System.currentTimeMillis()
        database.withTransaction {
            providerDao.clearAll()
            if (providers.isNotEmpty()) {
                providerDao.insertAll(
                    providers.map {
                        ProviderSyncEntity(
                            providerId = it.id,
                            name = it.name,
                            senderId = it.senderId,
                            direction = it.direction,
                            syncedAtEpoch = now
                        )
                    }
                )
            }
        }
    }

    suspend fun handleIncoming(sms: IncomingSms): CaptureDecision {
        val settings = settingsStore.settings.first()
        val providers = providerDao.observeAll().first()
        if (providers.isEmpty()) return CaptureDecision.DROPPED_NO_PROVIDERS
        if (!gateAllows(sms.sender, providers)) return CaptureDecision.DROPPED_UNMATCHED_SENDER

        val dedupHash = Dedup.hash(sms.sender, sms.body, sms.receivedAtEpochMillis / 1000)
        val entity = CapturedSmsEntity(
            id = UUID.randomUUID().toString(),
            sender = sms.sender,
            body = sms.body,
            receivedAtEpoch = sms.receivedAtEpochMillis,
            status = CapturedSmsEntity.STATUS_PENDING,
            resultStatus = null,
            resultReason = null,
            dedupHash = dedupHash,
            createdAtEpoch = System.currentTimeMillis()
        )
        val insertedRow = withContext(Dispatchers.IO) { captureDao.insert(entity) }
        if (insertedRow == -1L) return CaptureDecision.DUPLICATE_IGNORED

        val online = connectivityObserver.isOnline.value
        val initialDetail = if (online) "Received" else "Queued offline"
        CaptureNotifications.postOrUpdate(
            context = context,
            messageId = entity.id,
            sender = entity.sender,
            detail = initialDetail,
            enabled = settings.notificationsEnabled
        )
        UploadWorker.enqueue(context)
        return CaptureDecision.CAPTURED
    }

    suspend fun pingHealthz(): Int? = try {
        apiClient.api.healthz().code()
    } catch (e: Exception) {
        null
    }

    suspend fun heartbeat(): HeartbeatResult {
        val request = HeartbeatRequest(
            appVersion = BuildConfig.VERSION_NAME,
            osVersion = "Android ${Build.VERSION.RELEASE}"
        )
        return try {
            val response = apiClient.api.heartbeat(request)
            if (response.code() == 401 || response.code() == 403) {
                return HeartbeatResult.Unauthorized
            }
            val body = response.body()
            if (!response.isSuccessful || body == null || !body.success) {
                return HeartbeatResult.Failure("HTTP ${response.code()}")
            }
            val providers = body.data?.providers.orEmpty()
            replaceProviders(providers)
            HeartbeatResult.Success(providers)
        } catch (e: IOException) {
            HeartbeatResult.Failure(e.message)
        } catch (e: Exception) {
            HeartbeatResult.Failure(e.message)
        }
    }

    suspend fun uploadOnce(): UploadOutcome {
        val batch = captureDao.pendingOldest(Batch.MAX_BATCH_SIZE)
        if (batch.isEmpty()) return UploadOutcome.ALL_CAUGHT_UP
        return try {
            val request = MessagesRequest(
                messages = batch.map {
                    OutgoingMessageDto(
                        clientMsgId = it.id,
                        senderId = it.sender.takeIf { sender -> sender.isNotBlank() },
                        body = it.body,
                        deviceReceivedAt = isoUtc(it.receivedAtEpoch)
                    )
                }
            )
            val response = apiClient.api.sendMessages(request)
            if (!response.isSuccessful) return UploadOutcome.RETRYABLE_FAILURE
            val results = response.body()?.data?.results
            if (results.isNullOrEmpty()) return UploadOutcome.RETRYABLE_FAILURE

            val byClientId = results.associateBy { result -> result.clientMsgId }
            val notificationsEnabled = settingsStore.settings.first().notificationsEnabled
            for (item in batch) {
                val result = byClientId[item.id] ?: continue
                captureDao.markSent(item.id, result.status, result.error)
                CaptureNotifications.postOrUpdate(
                    context = context,
                    messageId = item.id,
                    sender = item.sender,
                    detail = describeServerResult(result),
                    enabled = notificationsEnabled
                )
            }
            UploadOutcome.BATCH_COMPLETED
        } catch (e: IOException) {
            UploadOutcome.RETRYABLE_FAILURE
        } catch (e: SerializationException) {
            UploadOutcome.RETRYABLE_FAILURE
        } catch (e: Exception) {
            UploadOutcome.FATAL_FAILURE
        }
    }

    private fun gateAllows(sender: String, providers: List<ProviderSyncEntity>): Boolean {
        val normalized = sender.trim().lowercase(Locale.US)
        if (normalized.isEmpty()) return false
        val explicitMatch = providers.any { provider ->
            !provider.senderId.isNullOrBlank() &&
                provider.senderId.trim().lowercase(Locale.US) == normalized
        }
        if (explicitMatch) return true
        return providers.any { it.senderId.isNullOrBlank() }
    }

    private fun describeServerResult(result: MessageResultDto): String = when (result.status.lowercase(Locale.US)) {
        "parsed", "duplicate" -> "Uploaded ✓"
        "skipped" -> "Skipped: ${result.error ?: "not a payment SMS"}"
        "unmatched" -> "Skipped: no matching template"
        "error" -> "Rejected: ${result.error ?: "unknown error"}"
        else -> "Uploaded ✓"
    }

    private fun isoUtc(epochMillis: Long): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(epochMillis))
    }
}

object CaptureNotifications {

    const val CHANNEL_ID = "captures"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "Payment SMS captures", NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = "Delivery updates for captured payment messages"
        manager.createNotificationChannel(channel)
    }

    fun postOrUpdate(context: Context, messageId: String, sender: String, detail: String, enabled: Boolean) {
        if (!enabled) return
        ensureChannel(context)
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Payment SMS from $sender")
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()
        try {
            manager.notify(messageId.hashCode(), notification)
        } catch (e: SecurityException) {
        }
    }
}
