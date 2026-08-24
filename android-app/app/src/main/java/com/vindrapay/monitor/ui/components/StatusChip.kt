package com.vindrapay.monitor.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.vindrapay.monitor.ui.theme.Amber500
import com.vindrapay.monitor.ui.theme.Green500
import com.vindrapay.monitor.ui.theme.Red500

enum class ChipTone { GOOD, WARN, BAD, NEUTRAL }

fun chipToneForStatus(status: String?): ChipTone = when (status?.lowercase()) {
    "parsed", "duplicate", "sent" -> ChipTone.GOOD
    "pending", "unmatched", "skipped" -> ChipTone.WARN
    "error" -> ChipTone.BAD
    else -> ChipTone.NEUTRAL
}

@Composable
fun StatusChip(text: String, tone: ChipTone, modifier: Modifier = Modifier) {
    val accent = when (tone) {
        ChipTone.GOOD -> Green500
        ChipTone.WARN -> Amber500
        ChipTone.BAD -> Red500
        ChipTone.NEUTRAL -> Color.Unspecified
    }
    val container = if (accent == Color.Unspecified) {
        MaterialTheme.colorScheme.surfaceVariant
    } else {
        accent.copy(alpha = 0.18f)
    }
    val content = if (accent == Color.Unspecified) {
        MaterialTheme.colorScheme.onSurfaceVariant
    } else {
        accent
    }
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = container,
        contentColor = content
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
        )
    }
}
