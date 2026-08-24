package com.vindrapay.monitor.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Green500,
    onPrimary = Color(0xFF052E16),
    primaryContainer = Color(0xFF14532D),
    onPrimaryContainer = Color(0xFFDCFCE7),
    secondary = Blue500,
    onSecondary = Color(0xFF0B1B33),
    tertiary = Amber500,
    onTertiary = Color(0xFF331F00),
    background = Dark900,
    onBackground = Gray200,
    surface = Dark800,
    onSurface = Gray200,
    surfaceVariant = Dark700,
    onSurfaceVariant = Gray400,
    error = Red500,
    onError = Color(0xFF330B0B),
    outline = Color(0xFF374151)
)

@Composable
fun VindraPayTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = AppTypography,
        content = content
    )
}
