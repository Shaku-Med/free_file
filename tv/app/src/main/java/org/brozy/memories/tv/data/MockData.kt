package org.brozy.memories.tv.data

data class MediaItem(
    val id: String,
    val title: String,
    val creator: String,
    val meta: String,
    val hue: Float,
    val kind: String = "video",
)

val ContinueWatching = listOf(
    MediaItem("1", "Golden hour on the coast road", "mira.lens", "12:41 · 62% watched", 28f),
    MediaItem("2", "Episode 3 — The Harbor", "north.series", "42:08 · 38% watched", 195f),
    MediaItem("3", "Building a desk from scrap wood", "forge.home", "24:11 · 15% watched", 18f),
)

val ForYou = listOf(
    MediaItem("4", "Tokyo rain reflections", "yuki.frames", "8:02 · 890K views", 250f),
    MediaItem("5", "Late studio session — drums only", "knox.audio", "0:48 · Reel", 210f, "reel"),
    MediaItem("6", "Kitchen experiments: citrus glaze", "nova.bites", "18:20 · 62K views", 55f),
    MediaItem("7", "Night drive — empty highways", "volt.motion", "1:05 · Reel", 265f, "reel"),
    MediaItem("8", "How we lit the warehouse set", "stage.light", "15:33 · 54K views", 200f),
    MediaItem("9", "Quiet library mornings", "calm.rooms", "Photo · 19K views", 180f, "image"),
)

val Subscriptions = listOf(
    MediaItem("10", "Board flip compilation #4", "skate.arc", "0:32 · Reel", 340f, "reel"),
    MediaItem("11", "Film stills from last summer", "amber.roll", "Photo · 12K views", 42f, "image"),
    MediaItem("12", "Coffee pour under soft light", "brew.still", "0:27 · Reel", 15f, "reel"),
)
