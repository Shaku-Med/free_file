import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import crypto from "node:crypto";
import db from "~/lib/Database/supabase";
import { attachIsMusic } from "~/lib/files/attachIsMusic.server";
import { isAuthenticated } from "~/lib/Security/Password";
import { stripGithubRepoForClient } from "~/lib/githubStorage";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { rateLimiter, RateLimiter } from "~/routes/Auth/fun/rateLimit";
import {
  collectSeriesMemberIds,
  getSeriesUpNextVideos,
  groupSeriesRpcRows,
  mapSeriesRpcRowToFileType,
} from "~/routes/Dynamic/fun/mapSeriesRpcRows";
import type { FileType, SeriesEpisodeGroup } from "~/lib/types";

const DEFAULT_HEAD = 5;
const DEFAULT_TAIL = 20;
const MAX_HEAD = 10;
const MAX_TAIL = 40;
const MAX_SERVED_IDS = 500;
const REFILL_THRESHOLD = 4;
const UUID_RE = /^[0-9a-f-]{36}$/i;
// Tightened from 4-char min. Real IDs are 32-hex from crypto/rand; allow a
// reasonable range to cover legacy formats but reject short fuzz inputs.
const UNIQUE_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;
// Reject absurd payloads before parsing. 500 UUIDs (~18 KB) + overhead fits.
const MAX_BODY_BYTES = 64 * 1024;
// Rate limit: cap per user/IP. Two reasons:
//   1. Each call fires 1-3 DB RPCs; a hammered endpoint exhausts the pool.
//   2. The endpoint is a discovery surface  attackers probing for series
//      structure should hit a wall fast.
const RL_MAX = 120;
const RL_WINDOW_MS = 60 * 1000;
const RL_BLOCK_MS = 5 * 60 * 1000;

type Body = {
  current_file_id?: string;
  current_unique_id?: string;
  session_seed?: string;
  served_ids?: string[];
  served_creator_ids?: string[];
  session_cats?: string[];
  page_size?: { head?: number; tail?: number };
  mode?: "init" | "advance";
};

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function filterUuids(arr: unknown, max: number): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v === "string" && UUID_RE.test(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function filterUniqueIds(arr: unknown, max: number): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v === "string" && UNIQUE_ID_RE.test(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function filterStrings(arr: unknown, max: number, len: number): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v === "string" && v.length > 0 && v.length <= len) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function makeSeed(userId: string | undefined): string {
  // HMAC instead of raw "<userId>:<bucket>" so the seed we hand back to the
  // client doesn't expose the userId. Still deterministic for the same user
  // within a 6h window  same bucket → same shuffle; bucket flip → reshuffle.
  const bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
  const secret =
    process.env.SEGMENT_TOKEN_SECRET ||
    process.env.SERVER_AUTH ||
    "play-queue-seed-fallback";
  return crypto
    .createHmac("sha256", secret)
    .update(`${userId ?? "anon"}:${bucket}`)
    .digest("hex")
    .slice(0, 24);
}

function mapRelatedRow(row: Record<string, unknown>): {
  file: FileType;
  liked: boolean;
  disliked: boolean;
} {
  return {
    file: {
      id: row.id,
      created_at: row.created_at,
      endpoint: row.endpoint || "",
      filename: row.filename,
      unique_id: row.unique_id,
      file_size: row.file_size,
      file_type: row.file_type,
      is_adult: row.is_adult,
      owner_id: row.owner_id,
      is_public: row.is_public,
      file_description: row.file_description,
      file_title: row.file_title || "",
      default_thumbnail: row.default_thumbnail || null,
      preview_endpoint: row.preview_endpoint || null,
      view_count: row.view_count,
      share_count: row.share_count,
      is_reel: row.is_reel,
      is_series_main: row.is_series_main,
      is_files_series_item: row.is_files_series_item,
      file_series_id: row.file_series_id,
      file_series_episode_id: row.file_series_episode_id,
      feed_reel_cluster_id:
        row.feed_reel_cluster_id != null && row.feed_reel_cluster_id !== ""
          ? Number(row.feed_reel_cluster_id)
          : null,
      duration: row.duration,
      categories: row.categories,
      tags: row.tags,
      colors: row.colors,
      metadata: row.metadata,
      like_count: Number(row.like_count) || 0,
      dislike_count: Number(row.dislike_count) || 0,
      comment_count: Number(row.comment_count) || 0,
      engagement_score: Number(row.engagement_score) ?? 0,
      owner: row.owner_username
        ? {
            id: row.owner_id,
            username: row.owner_username,
            profile_pic: row.owner_profile_pic || "",
            verified: row.owner_verified ?? false,
            about: row.owner_about ?? null,
          }
        : null,
    } as FileType,
    liked: Boolean(row.user_has_liked),
    disliked: Boolean(row.user_has_disliked),
  };
}

/**
 * POST /api/play-queue/global
 *
 * Returns the user's globally-persisted play queue split into:
 *   - head:   anchored to current_file_id (or empty if none provided)
 *   - tail:   personalized feed continuation
 *   - series: if current file is part of a series, the rest of it
 *
 * Stateless. Server generates a session_seed if none supplied; client should
 * echo it back on subsequent calls to keep the shuffle stable. Reels are
 * excluded from both head and tail (they have their own /api/reel-feed).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }
  if (!db) {
    return data({ error: "Database not initialized" }, { status: 500 });
  }

  // Reject oversize bodies before parsing  protects against a 100 MB JSON
  // payload starving the process. We trust the declared Content-Length only
  // as a fast-path; absence/over-cap below.
  const declaredLen = request.headers.get("content-length");
  if (declaredLen) {
    const n = Number(declaredLen);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return data({ error: "Body too large" }, { status: 413 });
    }
  }

  let body: Body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return data({ error: "Body too large" }, { status: 413 });
    }
    const parsed = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return data({ error: "Invalid body" }, { status: 400 });
    }
    body = parsed as Body;
  } catch {
    return data({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentUniqueId =
    typeof body.current_unique_id === "string" && UNIQUE_ID_RE.test(body.current_unique_id)
      ? body.current_unique_id
      : null;

  const headSize = clampInt(body.page_size?.head, 1, MAX_HEAD, DEFAULT_HEAD);
  const tailSize = clampInt(body.page_size?.tail, 1, MAX_TAIL, DEFAULT_TAIL);
  const servedIds = filterUniqueIds(body.served_ids, MAX_SERVED_IDS);
  const servedCreatorIds = filterUuids(body.served_creator_ids, MAX_SERVED_IDS);
  const sessionCats = filterStrings(body.session_cats, 20, 80);

  const user = await isAuthenticated(request, ["id"]);
  const userId: string | undefined = user?.id || undefined;

  // Rate limit by userId (auth'd) or by IP (anon). Keyed per-endpoint so it
  // doesn't share buckets with other API routes.
  const rlKey = userId || `ip:${RateLimiter.getClientIP(request)}`;
  const rl = rateLimiter.checkLimit(
    rlKey,
    "api-play-queue-global",
    RL_MAX,
    RL_WINDOW_MS,
    RL_BLOCK_MS,
  );
  if (!rl.allowed) {
    const waitMs = (rl.blockedUntil ?? rl.resetAt ?? Date.now() + RL_WINDOW_MS) - Date.now();
    return data(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil(waitMs / 1000))) },
      },
    );
  }

  // Seed stable within a 6h window per user; client can override.
  const sessionSeed =
    typeof body.session_seed === "string" && body.session_seed.length > 0 && body.session_seed.length <= 128
      ? body.session_seed
      : makeSeed(userId);

  // Resolve the anchor file (if any). Without it we still return a useful tail.
  let anchorFile: Record<string, any> | null = null;
  if (currentUniqueId) {
    const { data: rawFile, error: fileErr } = await db
      .from("files")
      .select("id, unique_id, owner_id, file_series_id, is_public, visibility, is_adult, upload_status, categories")
      .eq("unique_id", currentUniqueId)
      .maybeSingle();
    if (fileErr) {
      console.error("[play-queue/global] anchor fetch:", fileErr);
    } else if (rawFile) {
      // Apply access control. If denied, we silently fall back to no anchor —
      // the client doesn't get a useful response otherwise, and the route is
      // a discovery surface (not a permission surface).
      const accessible = await filterFilesByAccess(request, [rawFile as any]);
      if (accessible.length > 0) anchorFile = rawFile;
    }
  }

  const likedFileIds: string[] = [];
  const dislikedFileIds: string[] = [];
  let seriesEpisodes: SeriesEpisodeGroup[] | null = null;

  // --- Series detection ---
  if (anchorFile && userId && anchorFile.file_series_id && anchorFile.owner_id) {
    const { data: seriesRows, error: seriesErr } = await db.rpc(
      "get_series_episodes_with_items_for_viewer",
      {
        p_file_series_id: anchorFile.file_series_id,
        p_series_owner_id: anchorFile.owner_id,
        p_viewer_id: userId,
      },
    );

    if (!seriesErr && Array.isArray(seriesRows) && seriesRows.length > 0) {
      const forAccess = (seriesRows as Record<string, unknown>[]).map((r) => {
        const base = mapSeriesRpcRowToFileType(r);
        return {
          ...base,
          is_adult: Boolean(r.is_adult),
          is_public: r.is_public !== false,
          owner_id: String(r.owner_id ?? base.owner_id ?? ""),
          upload_status: typeof r.upload_status === "string" ? r.upload_status : undefined,
        };
      });
      const allowed = await filterFilesByAccess(request, forAccess);
      const allowedIds = new Set(allowed.map((f) => f.id).filter(Boolean));
      const filtered = (seriesRows as Record<string, unknown>[]).filter(
        (r) => allowedIds.has(String(r.id)) && !Boolean(r.is_adult),
      );
      if (filtered.length > 0) {
        seriesEpisodes = groupSeriesRpcRows(filtered);
        for (const r of filtered) {
          if (r.user_has_liked) likedFileIds.push(String(r.id));
          if (r.user_has_disliked) dislikedFileIds.push(String(r.id));
        }
      }
    }
  }

  const seriesUpNext = currentUniqueId
    ? getSeriesUpNextVideos(seriesEpisodes, currentUniqueId)
    : [];
  const seriesMemberIds = collectSeriesMemberIds(seriesEpisodes);

  // --- Head + tail in parallel ---
  // Head: anchored on the current file (if any) for tight relevance.
  // Tail: personalized feed continuation, ignoring the anchor entirely.
  const headPromise = anchorFile
    ? db.rpc("get_related", {
        p_file_id: anchorFile.id,
        p_user_id: userId || null,
        p_limit: headSize,
        p_cursor_pos: 0,
        p_exclude_ids: servedIds.length > 0 ? servedIds.filter((id) => UUID_RE.test(id)) : [],
        p_session_cats: sessionCats,
        p_session_seed: sessionSeed,
        p_seen_creator_ids: servedCreatorIds,
      })
    : Promise.resolve({ data: [], error: null });

  const tailPromise = db.rpc("get_feed", {
    p_user_id: userId || null,
    p_limit: tailSize,
    p_category: null,
    p_reels_only: false,
    p_seed: sessionSeed,
    p_cursor_pos: 0,
    ...(servedIds.length > 0
      ? { p_exclude_ids: servedIds.filter((id) => UUID_RE.test(id)) }
      : {}),
    ...(sessionCats.length > 0 ? { p_session_cats: sessionCats } : {}),
  });

  const [headRes, tailRes] = await Promise.all([headPromise, tailPromise]);

  if (headRes.error) console.error("[play-queue/global] head:", headRes.error);
  if (tailRes.error) console.error("[play-queue/global] tail:", tailRes.error);

  let headRows: Record<string, unknown>[] = Array.isArray(headRes.data) ? headRes.data : [];
  let tailRows: Record<string, unknown>[] = Array.isArray(tailRes.data) ? tailRes.data : [];

  if (headRows.length > 0) headRows = await filterFilesByAccess(request, headRows as any[]);
  if (tailRows.length > 0) tailRows = await filterFilesByAccess(request, tailRows as any[]);

  // --- Build response ---
  // Strip reels and series members; dedupe head from tail; map rows.
  const seenUniqueIds = new Set<string>();
  if (currentUniqueId) seenUniqueIds.add(currentUniqueId);
  for (const id of servedIds) seenUniqueIds.add(id);
  for (const id of seriesMemberIds) seenUniqueIds.add(id);

  const head: FileType[] = [];
  for (const r of headRows) {
    const mapped = mapRelatedRow(r);
    const uid = String(mapped.file.unique_id ?? "");
    if (!uid || seenUniqueIds.has(uid)) continue;
    if (mapped.file.is_reel) continue;
    seenUniqueIds.add(uid);
    head.push(mapped.file);
    if (mapped.liked) likedFileIds.push(String(r.id));
    if (mapped.disliked) dislikedFileIds.push(String(r.id));
  }

  const tail: FileType[] = [];
  for (const rawRow of tailRows) {
    const stripped = stripGithubRepoForClient(rawRow as Record<string, unknown>) as Record<
      string,
      unknown
    >;
    const mapped = mapRelatedRow(stripped);
    const uid = String(mapped.file.unique_id ?? "");
    if (!uid || seenUniqueIds.has(uid)) continue;
    if (mapped.file.is_reel) continue;
    seenUniqueIds.add(uid);
    tail.push(mapped.file);
    if (mapped.liked) likedFileIds.push(String(rawRow.id));
    if (mapped.disliked) dislikedFileIds.push(String(rawRow.id));
  }

  // get_related has no is_music; attach it for the card music icon.
  await attachIsMusic(db, head);
  await attachIsMusic(db, tail);
  if (seriesUpNext.length > 0) await attachIsMusic(db, seriesUpNext);

  return data(
    {
      head,
      tail,
      series:
        seriesUpNext.length > 0
          ? {
              file_series_id: anchorFile?.file_series_id ?? null,
              current_unique_id: currentUniqueId,
              episodes_remaining: seriesUpNext,
            }
          : null,
      session_seed: sessionSeed,
      refill_threshold: REFILL_THRESHOLD,
      user_actions: {
        likedFileIds: Array.from(new Set(likedFileIds)),
        dislikedFileIds: Array.from(new Set(dislikedFileIds)),
      },
    },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
};
