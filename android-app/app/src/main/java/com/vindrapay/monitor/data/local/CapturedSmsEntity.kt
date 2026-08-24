package com.vindrapay.monitor.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "captured_sms", indices = [Index(value = ["dedupHash"], unique = true)])
data class CapturedSmsEntity(
    @PrimaryKey val id: String,
    val sender: String,
    val body: String,
    val receivedAtEpoch: Long,
    val status: String,
    val resultStatus: String?,
    val resultReason: String?,
    val dedupHash: String,
    val createdAtEpoch: Long
) {
    companion object {
        const val STATUS_PENDING = "PENDING"
        const val STATUS_SENT = "SENT"
    }
}
