package com.vindrapay.monitor.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class HeartbeatRequest(
    @SerialName("app_version") val appVersion: String,
    @SerialName("os_version") val osVersion: String
)

@Serializable
data class ProviderDto(
    val id: String,
    val name: String,
    @SerialName("sender_id") val senderId: String? = null,
    val direction: String? = null
)

@Serializable
data class HeartbeatData(
    val providers: List<ProviderDto> = emptyList()
)

@Serializable
data class OutgoingMessageDto(
    @SerialName("client_msg_id") val clientMsgId: String,
    @SerialName("sender_id") val senderId: String?,
    val body: String,
    @SerialName("device_received_at") val deviceReceivedAt: String
)

@Serializable
data class MessagesRequest(
    val messages: List<OutgoingMessageDto>
)

@Serializable
data class MessageResultDto(
    @SerialName("client_msg_id") val clientMsgId: String,
    val status: String,
    val error: String? = null
)

@Serializable
data class MessagesData(
    val results: List<MessageResultDto> = emptyList()
)

@Serializable
data class ApiResponse<T>(
    val success: Boolean = false,
    val data: T? = null,
    val error: String? = null
)
