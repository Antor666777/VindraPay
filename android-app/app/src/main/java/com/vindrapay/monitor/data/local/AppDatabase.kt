package com.vindrapay.monitor.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [CapturedSmsEntity::class, ProviderSyncEntity::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun captureDao(): CaptureDao

    abstract fun providerDao(): ProviderDao

    companion object {
        fun build(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "vindrapay_monitor.db")
                .fallbackToDestructiveMigration()
                .build()
    }
}
