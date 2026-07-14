package org.brozy.memories.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import org.brozy.memories.tv.data.ContinueWatching
import org.brozy.memories.tv.data.ForYou
import org.brozy.memories.tv.data.MediaItem
import org.brozy.memories.tv.data.Subscriptions

private val NavLabels = listOf("Home", "Subscriptions", "Library", "Studio")

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun MemoriesTvApp() {
    var selectedNav by remember { mutableIntStateOf(0) }

    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp),
        horizontalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        TvSidebar(
            selected = selectedNav,
            onSelect = { selectedNav = it },
            modifier = Modifier
                .width(220.dp)
                .fillMaxHeight(),
        )

        when (selectedNav) {
            0 -> HomeScreen(modifier = Modifier.weight(1f))
            1 -> RowScreen(
                title = "Subscriptions",
                subtitle = "From creators you follow — UI mock",
                items = Subscriptions,
                modifier = Modifier.weight(1f),
            )
            2 -> RowScreen(
                title = "Library",
                subtitle = "Continue watching & saved — UI mock",
                items = ContinueWatching + ForYou.take(3),
                modifier = Modifier.weight(1f),
            )
            else -> StudioScreen(modifier = Modifier.weight(1f))
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun TvSidebar(
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = "Memories",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            text = "TV · UI preview",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
        )
        Spacer(Modifier.height(12.dp))
        NavLabels.forEachIndexed { index, label ->
            Surface(
                onClick = { onSelect(index) },
                modifier = Modifier.fillMaxWidth(),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1.05f),
                colors = ClickableSurfaceDefaults.colors(
                    containerColor = if (selected == index) {
                        MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)
                    } else {
                        Color.Transparent
                    },
                    focusedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.28f),
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    focusedContentColor = MaterialTheme.colorScheme.onSurface,
                ),
                shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
            ) {
                Text(
                    text = label,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        }
        Spacer(Modifier.weight(1f))
        Text(
            text = "D-pad / remote to focus",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f),
        )
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun HomeScreen(modifier: Modifier = Modifier) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(28.dp),
        contentPadding = PaddingValues(bottom = 32.dp),
    ) {
        item {
            FeaturedHero(ContinueWatching.first())
        }
        item {
            MediaRow(title = "Continue watching", items = ContinueWatching)
        }
        item {
            MediaRow(title = "For you", items = ForYou)
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun RowScreen(
    title: String,
    subtitle: String,
    items: List<MediaItem>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        Text(text = title, style = MaterialTheme.typography.headlineMedium)
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
            modifier = Modifier.padding(top = 6.dp, bottom = 20.dp),
        )
        MediaRow(title = null, items = items)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun StudioScreen(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(text = "Brozy Studio", style = MaterialTheme.typography.headlineMedium)
        Text(
            text = "Creator tools on TV will come later. This screen is a layout placeholder.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            listOf("184K views", "1.2K hours", "+312 subs").forEach { label ->
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(MaterialTheme.colorScheme.background)
                        .padding(20.dp),
                ) {
                    Text(text = label, style = MaterialTheme.typography.titleLarge)
                }
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun FeaturedHero(item: MediaItem) {
    Surface(
        onClick = {},
        modifier = Modifier
            .fillMaxWidth()
            .height(260.dp),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(22.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            focusedContainerColor = Color.Transparent,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(22.dp))
                .background(thumbBrush(item.hue)),
        ) {
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(28.dp),
            ) {
                Text(
                    text = "Featured",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.headlineLarge,
                    color = Color.White,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "@${item.creator} · ${item.meta}",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.White.copy(alpha = 0.75f),
                )
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun MediaRow(title: String?, items: List<MediaItem>) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (title != null) {
            Text(text = title, style = MaterialTheme.typography.titleLarge)
        }
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            contentPadding = PaddingValues(end = 8.dp),
        ) {
            items(items, key = { it.id }) { item ->
                MediaCard(item)
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun MediaCard(item: MediaItem) {
    Surface(
        onClick = {},
        modifier = Modifier.width(260.dp),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(16.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = MaterialTheme.colorScheme.surface,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            focusedContentColor = MaterialTheme.colorScheme.onSurface,
        ),
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .background(thumbBrush(item.hue)),
            ) {
                if (item.kind != "video") {
                    Text(
                        text = item.kind.uppercase(),
                        modifier = Modifier
                            .padding(10.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                    )
                }
            }
            Column(Modifier = Modifier.padding(14.dp)) {
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "@${item.creator}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
                )
                Text(
                    text = item.meta,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.45f),
                )
            }
        }
    }
}

private fun thumbBrush(hue: Float): Brush {
    val a = Color.hsl(hue, 0.65f, 0.42f)
    val b = Color.hsl((hue + 40f) % 360f, 0.55f, 0.28f)
    return Brush.linearGradient(listOf(a, b, Color(0xFF1C2230)))
}
