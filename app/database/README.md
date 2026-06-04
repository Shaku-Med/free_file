# Database layout

This directory holds every `.sql` file that defines or mutates the Supabase
schema this app talks to. Read this top-to-bottom before adding a new file so
duplicates and superseded versions don't pile up again.

## Folders

| Folder | What lives here |
|---|---|
| `default-schemas/` | The base table definitions. Applying every file here to an empty Postgres gives you the static schema (no RPCs yet, no functions). |
| `migrations/` | Incremental DDL changes + RPC functions added after the base schema. Apply in any order **except** where one file's comment explicitly says it must run after another (e.g. `fix_feed_series_reference.sql`). Each file is idempotent (`IF NOT EXISTS` / `OR REPLACE`). |
| `migrations/legacy/` | Superseded migration files. Kept for historical reference only — **do not apply to a fresh database**. The active replacement is documented in each file's header. |
| `V2/` | The second-batch RPC / feature files (search, feed, comments, playlists, subscriptions, etc.). Same idempotency rules. |
| `V2/legacy/` | Superseded V2 files. Same rule as `migrations/legacy/`. |

## Apply order for a fresh database

1. Everything in `default-schemas/`
2. Everything in `migrations/` (skip `legacy/`)
3. Everything in `V2/` (skip `legacy/`)
4. `migrations/fix_feed_series_reference.sql` (patch — must run after `V2/feed_smart_v6.sql` and `V2/get_reel_feed_v2.sql`)

## Active vs legacy — quick reference

### Active migrations (in `migrations/`)

| File | What it does |
|---|---|
| `upload_quota.sql` | **Canonical** quota subsystem (ledger table + reserve/finalize/refund/record/get-usage). 30-day rolling window. Supersedes the three legacy quota files. |
| `add_*.sql` | Column-adding migrations. All additive; safe to re-run. |
| `analytics_events.sql` | Per-file / per-owner analytics views. |
| `backfill_default_thumbnail.sql` | One-shot backfill of `default_thumbnail` from `thumbnails[]`. |
| `captions.sql` | Caption tokens + cleanup. |
| `comments_content_or_gif_include_image.sql` | Constraint fix so image-only comments validate. |
| `comments_file_settings_owner_moderation.sql` | Owner-side comment moderation (replaces `add_comment_moderation.sql`). |
| `comment_tree_images.sql` | `get_comment_tree_images` RPC. |
| `error_logs.sql` | Server-error log table + purge function. |
| `feed_preferences.sql` | User feed-preference RPCs. |
| `files_github_repo_default_memories.sql` | Default value backfill on `files.github_repo`. |
| `file_view_events_v2.sql` | View-counting RPC (replaces `file_view_events.sql`). |
| `fix_feed_series_reference.sql` | Patch on top of `V2/feed_smart_v6.sql` + `V2/get_reel_feed_v2.sql` (removes a NOT EXISTS clause against a missing `public.series` table). |
| `get_file_for_owner_edit.sql` | RPC used by `/api/files`. |
| `profile_tabs_watch_history.sql` | Watch history + liked-files RPCs. |
| `r2_secondary_assets.sql` | Caption token RPCs reused for R2 secondary assets. |
| `reports.sql` | Submit / lookup report RPCs. |
| `user_watch_progress.sql` | Watch progress / series resume RPCs. |

### Active V2 files

| File | What it provides |
|---|---|
| `adult_review_functions.sql` | `get_adult_review_status`, `submit_adult_review_request`, `respond_adult_review`. |
| `comments.sql` + `comments_functions.sql` + `comment_reactions_and_gifs.sql` | Comments table, RPCs, reaction columns. |
| `feed_smart_v6.sql` | **Current `get_feed`** (Instagram-grade personalization). |
| `file_engagement_stats_refresh.sql` | `refresh_file_engagement_stats` materialized refresh. |
| `files_upload_status.sql` | `upload_status` column on `files`. |
| `get_batch_interactions.sql` | Bulk like/save/dislike lookup. |
| `get_by_tag.sql` | Tag-based feed RPC. |
| `get_endscreen_suggestions.sql` | Player end-card suggestions RPC. |
| `get_files_by_ids.sql` | Bulk fetch by IDs (for playlists). |
| `get_pip_feed.sql` | PiP feed RPC. |
| `get_profile_files.sql` | Profile videos RPC. |
| `get_reel_feed_v2.sql` | **Current `get_reel_feed`**. |
| `get_related_v3.sql` | **Current `get_related`**. |
| `get_series_episodes_with_items_for_viewer.sql` | Series viewer RPC. |
| `get_subscription_channels_recent_uploads.sql` | Channel recent uploads RPC. |
| `get_tag_suggestions.sql` | Tag autocomplete RPC. |
| `get_video_endcards.sql` | End-card data RPC. |
| `notifications*.sql` | Notifications table + later additions (subscriber types, mentions). All additive — keep all three. |
| `personalization_tables.sql` | Personalization tables + scoring RPCs. |
| `playlists.sql` + `playlist_functions.sql` | Playlists schema + RPCs. |
| `push_subscriptions.sql` | Web Push subscription columns. |
| `search_files_v4.sql` | **Current `search_files`** + normalization helpers. |
| `search_series_roots_for_query.sql` | Series search RPC. |
| `subscription_functions.sql` | Channel sub/unsub + counts. |
| `upload_jobs.sql` | `upload_jobs` table for worker progress. |
| `users_file_count.sql` | `sync_user_file_count` trigger function. |
| `users_nsfw_setting.sql` | `users.show_nsfw` column. |

### What's in `legacy/` (do not re-apply on a fresh DB)

**`migrations/legacy/`:**
- `weekly_upload_quota.sql` — superseded by `upload_quota.sql`.
- `weekly_upload_quota_record.sql` — superseded by `upload_quota.sql`.
- `monthly_upload_quota.sql` — interim 30-day-window patch, folded into `upload_quota.sql`.
- `file_view_events.sql` — replaced by `file_view_events_v2.sql`.
- `add_comment_moderation.sql` — replaced by `comments_file_settings_owner_moderation.sql`.

**`V2/legacy/`:**
- `get_reel_feed.sql` — replaced by `get_reel_feed_v2.sql`.
- `get_related.sql`, `get_related_v2.sql` — replaced by `get_related_v3.sql`.
- `search_files_v2.sql`, `search_files_v3.sql` — replaced by `search_files_v4.sql`.
- `feed_smart_v5.sql` — replaced by `feed_smart_v6.sql` (+ the individual reel/related/subscription files which split out from v5).
- `feed_get_feed_pagination_patch.sql` — feed v4.1, replaced by `feed_smart_v6.sql`.

## When you add a new SQL file

1. Make it idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, drop-and-recreate signatures with the DO-block pattern used in `upload_quota.sql`).
2. Keep a tight scope per file — one feature / one fix.
3. If you're replacing an RPC, **move the old file to `legacy/`** in the same commit and update the entry in this README.
4. If the file must run after another, say so in the header comment.
5. Never embed secrets, API keys, or environment-specific URLs.
