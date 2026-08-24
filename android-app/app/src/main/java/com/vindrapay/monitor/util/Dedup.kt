package com.vindrapay.monitor.util

import java.security.MessageDigest

object Dedup {
    fun hash(sender: String, body: String, epochSecond: Long): String {
        val payload = "$sender|$body|$epochSecond"
        val digest = MessageDigest.getInstance("SHA-256").digest(payload.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
