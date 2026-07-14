package org.brozy.memories.tv.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

private val Background = Color(0xFF0F1115)
private val SurfaceColor = Color(0xFF171A21)
private val OnSurface = Color(0xFFF2F0EA)
private val Primary = Color(0xFFE8A45A)
private val OnPrimary = Color(0xFF1A1208)

@OptIn(ExperimentalTvMaterial3Api::class)
private val MemoriesDarkScheme = darkColorScheme(
    primary = Primary,
    onPrimary = OnPrimary,
    secondary = Primary,
    onSecondary = OnPrimary,
    background = Background,
    onBackground = OnSurface,
    surface = SurfaceColor,
    onSurface = OnSurface,
)

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun MemoriesTvTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MemoriesDarkScheme,
        content = content,
    )
}
