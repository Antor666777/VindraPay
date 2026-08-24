package com.vindrapay.monitor.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ProviderDao {

    @Query("DELETE FROM provider_sync")
    suspend fun clearAll()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(providers: List<ProviderSyncEntity>)

    @Query("SELECT * FROM provider_sync ORDER BY name ASC")
    fun observeAll(): Flow<List<ProviderSyncEntity>>
}
