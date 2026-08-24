package com.vindrapay.monitor.sms

import android.content.Context
import android.content.SharedPreferences
import android.telephony.SmsMessage
import android.util.Base64
import com.vindrapay.monitor.data.repo.IncomingSms
import java.util.TreeMap

object MultipartAssembler {

    private const val PREFS_NAME = "multipart_assembly"
    private const val STALE_AFTER_MILLIS = 24L * 60 * 60 * 1000

    private class AssemblyEntry(
        val total: Int,
        val receivedAtEpochMillis: Long,
        val parts: MutableMap<Int, String> = TreeMap()
    )

    private data class ConcatInfo(val reference: Int, val total: Int, val index: Int)

    fun accumulate(context: Context, messages: Array<SmsMessage>): List<IncomingSms> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val completed = ArrayList<IncomingSms>()
        for (message in messages) {
            val sender = message.originatingAddress ?: ""
            val body = message.messageBody ?: ""
            val timestamp = message.timestampMillis
            val concat = extractConcatInfo(message.pdu)
            if (concat == null || concat.total <= 1) {
                completed.add(IncomingSms(sender, body, timestamp))
                continue
            }
            val key = "$sender|${concat.reference}|${concat.total}"
            val entry = loadEntry(prefs, key) ?: AssemblyEntry(
                total = concat.total,
                receivedAtEpochMillis = timestamp
            )
            entry.parts[concat.index] = body
            if (entry.parts.size >= entry.total) {
                val joined = (1..entry.total).mapNotNull { seq -> entry.parts[seq] }.joinToString("")
                completed.add(IncomingSms(sender, joined, entry.receivedAtEpochMillis))
                prefs.edit().remove(key).apply()
            } else {
                saveEntry(prefs, key, entry)
            }
        }
        pruneStale(prefs, System.currentTimeMillis() - STALE_AFTER_MILLIS)
        return completed
    }

    private fun extractConcatInfo(pdu: ByteArray?): ConcatInfo? {
        if (pdu == null || pdu.size < 4) return null
        var cursor = 0
        val firstOctet = pdu[cursor].toInt() and 0xFF
        val hasUserDataHeader = (firstOctet and 0x40) != 0
        if (!hasUserDataHeader) return null
        cursor++
        val addressLengthDigits = pdu[cursor].toInt() and 0xFF
        if (addressLengthDigits > 20) return null
        cursor++
        val addressBytes = (addressLengthDigits + 1) / 2 + 1
        cursor += addressBytes
        cursor += 2
        cursor += 7
        if (pdu.size <= cursor + 1) return null
        cursor++
        val headerLength = pdu[cursor].toInt() and 0xFF
        if (headerLength == 0 || headerLength > 20) return null
        cursor++
        var consumed = 0
        var info: ConcatInfo? = null
        while (consumed + 2 <= headerLength && pdu.size >= cursor + 2) {
            val elementId = pdu[cursor].toInt() and 0xFF
            val elementLength = pdu[cursor + 1].toInt() and 0xFF
            cursor += 2
            if (pdu.size < cursor + elementLength) break
            if (info == null && elementId == 0x00 && elementLength == 3) {
                val reference = pdu[cursor].toInt() and 0xFF
                val total = pdu[cursor + 1].toInt() and 0xFF
                val index = pdu[cursor + 2].toInt() and 0xFF
                info = ConcatInfo(reference, total, index)
            } else if (info == null && elementId == 0x08 && elementLength == 4) {
                val reference = ((pdu[cursor].toInt() and 0xFF) shl 8) or (pdu[cursor + 1].toInt() and 0xFF)
                val total = pdu[cursor + 2].toInt() and 0xFF
                val index = pdu[cursor + 3].toInt() and 0xFF
                info = ConcatInfo(reference, total, index)
            }
            cursor += elementLength
            consumed += 2 + elementLength
        }
        return info?.takeIf { it.total in 2..255 && it.index in 1..it.total }
    }

    private fun saveEntry(prefs: SharedPreferences, key: String, entry: AssemblyEntry) {
        val builder = StringBuilder()
        builder.append(entry.total).append('|').append(entry.receivedAtEpochMillis).append('\n')
        for ((seq, body) in entry.parts) {
            builder.append(seq).append('|')
                .append(Base64.encodeToString(body.toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
                .append('\n')
        }
        prefs.edit().putString(key, builder.toString()).apply()
    }

    private fun loadEntry(prefs: SharedPreferences, key: String): AssemblyEntry? {
        val raw = prefs.getString(key, null) ?: return null
        return try {
            val lines = raw.split('\n').filter { it.isNotBlank() }
            if (lines.isEmpty()) return null
            val header = lines.first().split('|')
            val total = header[0].toInt()
            val receivedAt = header[1].toLong()
            val entry = AssemblyEntry(total, receivedAt)
            for (line in lines.drop(1)) {
                val separator = line.indexOf('|')
                if (separator <= 0) continue
                val seq = line.substring(0, separator).toInt()
                val encoded = line.substring(separator + 1)
                val body = String(Base64.decode(encoded, Base64.NO_WRAP), Charsets.UTF_8)
                entry.parts[seq] = body
            }
            entry
        } catch (e: Exception) {
            null
        }
    }

    private fun pruneStale(prefs: SharedPreferences, cutoffEpochMillis: Long) {
        val editor = prefs.edit()
        var dirty = false
        for ((key, value) in prefs.all) {
            val raw = value as? String ?: continue
            val header = raw.lineSequence().firstOrNull() ?: continue
            val receivedAt = header.split('|').getOrNull(1)?.toLongOrNull() ?: continue
            if (receivedAt < cutoffEpochMillis) {
                editor.remove(key)
                dirty = true
            }
        }
        if (dirty) editor.apply()
    }
}
