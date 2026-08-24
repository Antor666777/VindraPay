package com.vindrapay.monitor.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface CaptureDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: CapturedSmsEntity): Long

    @Query("SELECT * FROM captured_sms WHERE status = 'PENDING' ORDER BY receivedAtEpoch ASC LIMIT :limit")
    suspend fun pendingOldest(limit: Int): List<CapturedSmsEntity>

    @Query("SELECT COUNT(*) FROM captured_sms WHERE status = 'PENDING'")
    fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM captured_sms WHERE status = 'PENDING'")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM captured_sms WHERE status = 'SENT'")
    fun observeSentCount(): Flow<Int>

    @Query(
        "UPDATE captured_sms SET status = 'SENT', resultStatus = :resultStatus, resultReason = :resultReason " +
            "WHERE id = :id"
    )
    suspend fun markSent(id: String, resultStatus: String, resultReason: String?)

    @Query("SELECT * FROM captured_sms ORDER BY receivedAtEpoch DESC LIMIT :limit")
    fun observeRecent(limit: Int): Flow<List<CapturedSmsEntity>>
}
