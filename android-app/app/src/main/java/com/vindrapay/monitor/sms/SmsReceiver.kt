package com.vindrapay.monitor.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.vindrapay.monitor.MonitorApp
import kotlinx.coroutines.launch

class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val app = context.applicationContext as? MonitorApp ?: return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        val container = app.container
        val incoming = MultipartAssembler.accumulate(context, messages)
        if (incoming.isEmpty()) return

        container.applicationScope.launch {
            for (sms in incoming) {
                try {
                    container.captureRepository.handleIncoming(sms)
                } catch (e: Exception) {
                }
            }
        }
    }
}
