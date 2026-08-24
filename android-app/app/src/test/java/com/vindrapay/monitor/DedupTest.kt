package com.vindrapay.monitor

import com.vindrapay.monitor.util.Dedup
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DedupTest {

    @Test
    fun `hash is deterministic`() {
        val a = Dedup.hash("bKash", "You have received Tk 500.00 from 01712345678", 1700000000L)
        val b = Dedup.hash("bKash", "You have received Tk 500.00 from 01712345678", 1700000000L)
        assertEquals(a, b)
    }

    @Test
    fun `hash changes when sender differs`() {
        val a = Dedup.hash("bKash", "body", 1L)
        val b = Dedup.hash("bkash", "body", 1L)
        assertNotEquals(a, b)
    }

    @Test
    fun `hash changes when body differs`() {
        val a = Dedup.hash("bKash", "body one", 1L)
        val b = Dedup.hash("bKash", "body two", 1L)
        assertNotEquals(a, b)
    }

    @Test
    fun `hash changes when epoch second differs`() {
        val a = Dedup.hash("bKash", "body", 1000L)
        val b = Dedup.hash("bKash", "body", 2000L)
        assertNotEquals(a, b)
    }

    @Test
    fun `hash is lowercase hex of length 64`() {
        val hash = Dedup.hash("sender", "body", 42L)
        assertEquals(64, hash.length)
        assertTrue(hash.all { it.isDigit() || it in 'a'..'f' })
    }

    @Test
    fun `hash matches plain sha-256 of pipe-joined payload`() {
        val expected = MessageDigest.getInstance("SHA-256")
            .digest("a|b|7".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        assertEquals(expected, Dedup.hash("a", "b", 7L))
    }
}
