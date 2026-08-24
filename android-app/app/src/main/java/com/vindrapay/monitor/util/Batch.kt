package com.vindrapay.monitor.util

object Batch {
    const val MAX_BATCH_SIZE = 50

    fun <T> chunk(items: List<T>, size: Int = MAX_BATCH_SIZE): List<List<T>> {
        require(size > 0) { "size must be positive" }
        if (items.isEmpty()) return emptyList()
        val chunks = ArrayList<List<T>>((items.size + size - 1) / size)
        var start = 0
        while (start < items.size) {
            val end = minOf(start + size, items.size)
            chunks.add(items.subList(start, end).toList())
            start = end
        }
        return chunks
    }
}
