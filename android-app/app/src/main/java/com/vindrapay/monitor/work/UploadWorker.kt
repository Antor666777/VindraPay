package com.vindrapay.monitor.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.vindrapay.monitor.MonitorApp
import com.vindrapay.monitor.data.repo.UploadOutcome
import java.util.concurrent.TimeUnit

class UploadWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as MonitorApp).container
        var iterations = 0
        while (iterations < MAX_LOOPS_PER_RUN) {
            iterations++
            when (container.captureRepository.uploadOnce()) {
                UploadOutcome.ALL_CAUGHT_UP -> return Result.success()
                UploadOutcome.BATCH_COMPLETED -> continue
                UploadOutcome.RETRYABLE_FAILURE -> return Result.retry()
                UploadOutcome.FATAL_FAILURE -> return Result.failure()
            }
        }
        return Result.success()
    }

    companion object {
        const val UNIQUE_WORK_NAME = "upload-pending"
        private const val MAX_LOOPS_PER_RUN = 200

        fun enqueue(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}
