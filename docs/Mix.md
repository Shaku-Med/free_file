# Mix — deferred feature

Status: **removed from the product, kept as a target.**

A first version was built and then pulled because it was not developed far
enough to ship. This is the record of what it was, what was learned, and what
"properly developed" has to mean before it goes back in.

The code was removed rather than left dormant: half-wired recommendation
surfaces are worse than none, because they look finished and quietly train
users to ignore them.

---

## What a Mix is

An automatically generated, endless-feeling list of tracks built around a seed,
in the spirit of YouTube's radio mixes. Not a playlist: nobody curates it, it
belongs to no one, and it has no owner page.

Two DIFFERENT products share the name, and conflating them is the main design
trap:

| | What it is | How it is produced |
| --- | --- | --- |
| **Radio mix** (`RD<videoId>`) | Seeded from one specific track | On demand, per request |
| **Named mixes** (My Mix, Discover Mix) | Per-viewer, persistent, shown on Home | Precomputed on a schedule |

A radio mix cannot be precomputed: one exists for *every* track, so storing
them is `tracks` rows — and per viewer it becomes `users × tracks`. Named mixes
are the opposite: few per user, worth persisting.

---

## What was built (and works)

- **`music_related`** — item-item co-occurrence over `user_watch_history`,
  scored with cosine normalisation `co / sqrt(plays_a * plays_b)` so globally
  popular tracks don't attach themselves to every seed. Rebuilt by
  `rebuild_music_related()` (see `app/database/migrations/music_mix_related.sql`),
  intended to run nightly via `pg_cron`. **This part is sound and can be reused
  as-is.**
- Same-audio re-uploads collapse via `files.original_file_id`, so one song can't
  become its own neighbour.
- Layered candidates so a young library still returns something: co-occurrence,
  then shared tags, then same artist, then popular.
- Deterministic ordering keyed on the seed alone, so a shared link shows the
  same tracks in the same positions for everybody.
- Shareable ids (`RD<unique_id>`) derived from the seed — no storage, works for
  signed-out viewers.

## Why it was pulled

1. **Not enough data to be good.** ~7 users with 2+ music plays. Co-occurrence
   at that scale produces ties at score `1.000` (the same handful of people
   played everything), so the "algorithm" was mostly the popular-tracks
   fallback wearing a mix costume.
2. **Genre signal doesn't exist.** `files.categories` holds `"Music"`,
   `"Entertainment"` — not `"Amapiano"`. The tag layer can't tell genres apart,
   so similarity had no real semantic axis.
3. **Half a product.** Feed card, sidebar queue and player auto-advance landed;
   persisted per-user mixes and user-similarity did not. Shipping the visible
   half implies the invisible half exists.

---

## Definition of done (before it returns)

**Data thresholds — do not ship before these hold**

- [ ] A few hundred users with 2+ music plays (co-occurrence stops tying)
- [ ] Real genre signal — either curated genre tags, or audio-derived features

**The genre problem is the real blocker.** The fix is audio, not metadata:
extract tempo / key / MFCCs or a pretrained audio embedding in the existing
Python sidecar, store vectors in Postgres with **pgvector** (free on Supabase),
and let nearest-neighbour search do the work. Amapiano clusters by itself at
~112 BPM with its log-drum signature; no tag required. This also solves cold
start, since a brand-new upload has an embedding immediately while it has no
play history at all.

**Tables to add**

- [ ] `user_mix` — per-user "Your Mix", built nightly for ACTIVE users only,
      refreshed **weekly** (not monthly; a stale mix never surfaces new uploads)
- [ ] `user_similarity` — nightly user-user cosine over played tracks. Powers
      "someone with your taste listens to this". Needs a crowd to mean anything.
- [ ] Keep `music_related` and keep radio mixes on demand

**Product**

- [ ] Feed / related / search surfaces agreed up front, not bolted on
- [ ] Mini player + auto-advance behaviour defined for mix, series and neither
- [ ] Shared links keep their order (already solved — keep it)

---

## Reference: what the removed version looked like

- `GET /api/music/mix?list=RD<seed>&limit&offset` — layered candidates,
  deterministic order, lean payload, offset pagination
- `?list=RD<seed>&index=N&start_radio=1` on watch URLs, mirroring YouTube
- Feed card using the first track as poster, no owner (a mix has none)
- Sidebar queue replacing the old play-queue panel

`app/database/migrations/music_mix_related.sql` is intentionally **left in the
repo** — the co-occurrence job is the reusable half. It is inert until something
reads `music_related` again.
