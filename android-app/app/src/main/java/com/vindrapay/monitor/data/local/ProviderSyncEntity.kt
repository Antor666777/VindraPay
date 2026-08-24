package com.vindrapay.monitor.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "provider_sync")
data class ProviderSyncEntity(
    @PrimaryKey val providerId: String,
    val name: String,
    val senderId: String?,
    val direction: String?,
    val syncedAtEpoch: Long
)
