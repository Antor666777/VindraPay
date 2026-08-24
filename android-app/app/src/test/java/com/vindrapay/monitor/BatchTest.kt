package com.vindrapay.monitor

import com.vindrapay.monitor.util.Batch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BatchTest {

    @Test
    fun `empty input produces no batches`() {
        assertTrue(Batch.chunk(emptyList<Int>()).isEmpty())
    }

    @Test
    fun `input smaller than batch size is a single batch`() {
        val chunks = Batch.chunk(listOf(1, 2, 3), 50)
        assertEquals(1, chunks.size)
        assertEquals(listOf(1, 2, 3), chunks.first())
    }

    @Test
    fun `exact multiple splits evenly`() {
        val items = (1..100).toList()
        val chunks = Batch.chunk(items, 50)
        assertEquals(2, chunks.size)
        assertEquals((1..50).toList(), chunks[0])
        assertEquals((51..100).toList(), chunks[1])
    }

    @Test
    fun `remainder goes into a final smaller batch`() {
        val items = (1..7).toList()
        val chunks = Batch.chunk(items, 3)
        assertEquals(listOf(listOf(1, 2, 3), listOf(4, 5, 6), listOf(7)), chunks)
    }

    @Test
    fun `default size matches contract maximum`() {
        assertEquals(50, Batch.MAX_BATCH_SIZE)
    }

    @Test
    fun `concatenated chunks preserve order and content`() {
        val items = (0..122).toList()
        val rebuilt = Batch.chunk(items, 50).flatten()
        assertEquals(items, rebuilt)
    }
}
