import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import {
  mapRpcFileToReelFeedItem,
  type ReelFeedInteraction,
} from '~/lib/files/reelFilePayload';

const REEL_LIMIT = 15;
/** Related reels from the previous watch — prepended before the main feed batch. */
const CONTEXT_RELATED_MAX = 5;
/** Profile-channel mode: page through a creator's shorts before the global feed. */
const PROFILE_REEL_FETCH_LIMIT = 20;

/** UUID string compare-safe key (Supabase/JSON may vary in casing). */
function fileIdKey(id: unknown): string {
  return String(id ?? "").toLowerCase();
}

function parseIdsParam(param: string | null): string[] {
  if (!param) return [];

  try {
    const parsed = JSON.parse(param);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((id: unknown) => typeof id === 'string' && id.length > 0)
        .slice(0, 500);
    }
  } catch {
    return param
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .slice(0, 500);
  }

  return [];
}

function parseExcludeIds(url: URL): string[] {
  const seen = url.searchParams.get('seen');
  const exclude = url.searchParams.get('exclude_ids');
  const raw = exclude ?? seen;
  return parseIdsParam(raw);
}

function isReelRow(file: Record<string, unknown>): boolean {
  const v = file.is_reel;
  return v === true || v === 1 || v === 'true' || v === 't';
}

function mergeReelRows(
  related: Record<string, unknown>[],
  feed: Record<string, unknown>[],
  maxTotal: number,
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];

  const push = (file: Record<string, unknown>) => {
    if (merged.length >= maxTotal) return;
    const id = file.id ? fileIdKey(file.id) : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push(file);
  };

  for (const file of related.slice(0, CONTEXT_RELATED_MAX)) {
    push(file);
  }
  for (const file of feed) {
    push(file);
  }

  return merged;
}

async function fetchContextRelatedReels(
  request: Request,
  contextFileId: string,
  userId: string | undefined,
  excludeIds: string[],
  sessionCats: string[],
): Promise<Record<string, unknown>[]> {
  const pExcludeIds =
    excludeIds.length > 0
      ? excludeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
      : [];

  const rpcParams: Record<string, unknown> = {
    p_file_id: contextFileId,
    p_user_id: userId || null,
    p_limit: CONTEXT_RELATED_MAX + 4,
    p_cursor_pos: 0,
    ...(pExcludeIds.length > 0 ? { p_exclude_ids: pExcludeIds } : {}),
    ...(sessionCats.length > 0 ? { p_session_cats: sessionCats } : {}),
  };

  const { data: related, error } = await db.rpc('get_related', rpcParams);
  if (error) {
    console.error('Reel feed context related RPC error:', error);
    return [];
  }

  const accessible = await filterFilesByAccess(request, related || []);
  return accessible.filter((file) => isReelRow(file as Record<string, unknown>)) as Record<string, unknown>[];
}

async function fetchProfileOwnerReels(
  request: Request,
  profileUserId: string,
  viewerId: string | undefined,
  excludeIds: string[],
  cursorPos: number,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; hasMore: boolean; nextCursor: number }> {
  const { data: rows, error } = await db.rpc("get_profile_section_files", {
    p_profile_user_id: profileUserId,
    p_viewer_id: viewerId || null,
    p_section: "shorts",
    p_limit: limit + 1,
    p_cursor_pos: Math.max(0, cursorPos),
  });

  if (error) {
    console.error("Reel feed profile owner RPC error:", error);
    return { rows: [], hasMore: false, nextCursor: cursorPos };
  }

  const rowArr = Array.isArray(rows) ? rows : [];
  const hasMore = rowArr.length > limit;
  const sliced = rowArr.slice(0, limit);
  const accessible = await filterFilesByAccess(
    request,
    sliced as import("../fun/accessControl").FileData[],
  );
  const reels = accessible.filter((file) => isReelRow(file as Record<string, unknown>)) as Record<
    string,
    unknown
  >[];

  const exclude = new Set(excludeIds.map(fileIdKey));
  const filtered = reels.filter((file) => {
    const id = file.id ? fileIdKey(file.id) : "";
    return id && !exclude.has(id);
  });

  return {
    rows: filtered,
    hasMore,
    nextCursor: cursorPos + sliced.length,
  };
}

/**
 * Some RPC paths (get_related, profile sections, pre-v2 get_reel_feed) don't return
 * original_* columns — backfill them so every batch carries sound-chip data like SSR.
 */
async function backfillOriginalSound(rows: Record<string, unknown>[]): Promise<void> {
  const missingLink = rows.filter((r) => r.id && r.original_file_id === undefined);
  if (missingLink.length > 0) {
    const { data: links } = await db
      .from('files')
      .select('id, original_file_id')
      .in('id', missingLink.map((r) => String(r.id)));
    const linkById = new Map(
      (links ?? []).map((l: { id: unknown; original_file_id?: unknown }) => [
        fileIdKey(l.id),
        l.original_file_id ?? null,
      ]),
    );
    for (const r of missingLink) {
      r.original_file_id = linkById.get(fileIdKey(r.id)) ?? null;
    }
  }

  const need = rows.filter((r) => r.original_file_id && !r.original_unique_id);
  if (need.length === 0) return;

  const origIds = [...new Set(need.map((r) => String(r.original_file_id)))];
  const { data: origs } = await db
    .from('files')
    .select('id, unique_id, file_title, filename, default_thumbnail, preview_endpoint, created_at, is_public, visibility, is_adult, upload_status')
    .in('id', origIds);

  const byId = new Map<string, Record<string, unknown>>();
  for (const o of origs ?? []) {
    if (o.is_public === true && o.is_adult !== true && o.upload_status === 'complete') {
      byId.set(fileIdKey(o.id), o as Record<string, unknown>);
    }
  }
  for (const r of need) {
    const o = byId.get(fileIdKey(r.original_file_id));
    if (!o) continue;
    r.original_unique_id = String(o.unique_id);
    r.original_title = o.file_title ?? null;
    r.original_filename = o.filename ?? null;
    r.original_default_thumbnail = o.default_thumbnail ?? null;
    r.original_created_at = o.created_at ?? null;
  }
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const excludeIds = parseExcludeIds(url);
    // No seed = fresh random order per request, NOT a frozen 'default' hash -
    // otherwise every caller that omits the param serves the identical feed forever.
    const seedParam =
      url.searchParams.get('seed') ?? `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const categoryParam = url.searchParams.get('category');
    const maxDurationParam = url.searchParams.get('max_duration');
    const contextFileIdParam = url.searchParams.get('context_file_id');
    const profileUserIdParam = url.searchParams.get('profile_user_id');
    const profileExhaustedParam = url.searchParams.get('profile_exhausted') === '1';
    const profileCursorPos = Math.max(
      0,
      parseInt(url.searchParams.get('profile_cursor_pos') ?? '0', 10) || 0,
    );

    const profileUserId =
      profileUserIdParam && /^[0-9a-f-]{36}$/i.test(profileUserIdParam)
        ? profileUserIdParam
        : null;
    const profileModeActive = profileUserId != null && !profileExhaustedParam;

    const pExcludeIds =
      excludeIds.length > 0
        ? excludeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        : [];

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    const maxDuration = maxDurationParam != null && maxDurationParam !== ''
      ? parseFloat(maxDurationParam)
      : undefined;

    const sessionCatsParam = url.searchParams.get('session_cats');
    const sessionCats: string[] = sessionCatsParam
      ? (() => {
          try {
            const parsed = JSON.parse(sessionCatsParam);
            return Array.isArray(parsed) ? parsed.filter((c: unknown) => typeof c === 'string').slice(0, 20) : [];
          } catch { return []; }
        })()
      : [];

    const watchedIdsParam = url.searchParams.get('watched_ids');
    const watchedIds: string[] = watchedIdsParam
      ? (() => {
          try {
            const parsed = JSON.parse(watchedIdsParam);
            return Array.isArray(parsed)
              ? parsed.filter((id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id as string)).slice(0, 50)
              : [];
          } catch { return []; }
        })()
      : [];

    const contextFileId =
      !profileModeActive &&
      contextFileIdParam &&
      /^[0-9a-f-]{36}$/i.test(contextFileIdParam)
        ? contextFileIdParam
        : null;

    const relatedRows =
      contextFileId != null
        ? await fetchContextRelatedReels(request, contextFileId, userId, excludeIds, sessionCats)
        : [];

    let profileRows: Record<string, unknown>[] = [];
    let profileHasMore = false;
    let profileNextCursor = profileCursorPos;
    let profileExhausted = profileExhaustedParam || !profileUserId;

    if (profileModeActive && profileUserId) {
      const profileBatch = await fetchProfileOwnerReels(
        request,
        profileUserId,
        userId,
        excludeIds,
        profileCursorPos,
        PROFILE_REEL_FETCH_LIMIT,
      );
      profileRows = profileBatch.rows;
      profileHasMore = profileBatch.hasMore;
      profileNextCursor = profileBatch.nextCursor;
      if (!profileHasMore) {
        profileExhausted = true;
      } else if (profileRows.length === 0) {
        // Accessible rows were all excluded — keep paging the profile RPC.
        profileExhausted = false;
      }
    }

    let feedRows: Record<string, unknown>[] = [];
    let rawCount = 0;

    if (profileModeActive && !profileExhausted) {
      feedRows = profileRows;
      rawCount = profileRows.length;
    } else {
      const reelParams: Record<string, unknown> = {
        p_user_id: userId || null,
        p_limit: REEL_LIMIT,
        p_category: categoryParam || null,
        p_seed: seedParam,
        p_cursor_pos: 0,
        ...(pExcludeIds.length > 0 ? { p_exclude_ids: pExcludeIds } : {}),
        ...(maxDuration != null && Number.isFinite(maxDuration) && maxDuration > 0 ? { p_max_duration: maxDuration } : {}),
        ...(sessionCats.length > 0 ? { p_session_cats: sessionCats } : {}),
        ...(watchedIds.length > 0 ? { p_watched_ids: watchedIds } : {}),
      };

      const { data: reelFeed, error } = await db.rpc('get_reel_feed', reelParams);
      if (error) {
        console.error('Reel feed RPC error:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch reel feed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      feedRows = (await filterFilesByAccess(request, reelFeed || [])) as Record<string, unknown>[];
      rawCount = (reelFeed || []).length;

      if (profileUserId && profileExhausted && profileRows.length > 0) {
        feedRows = mergeReelRows(profileRows, feedRows, REEL_LIMIT + CONTEXT_RELATED_MAX);
        rawCount += profileRows.length;
      }
    }

    const filtered =
      profileModeActive && !profileExhausted
        ? profileRows.slice(0, REEL_LIMIT + CONTEXT_RELATED_MAX)
        : mergeReelRows(
            relatedRows,
            feedRows as Record<string, unknown>[],
            REEL_LIMIT + CONTEXT_RELATED_MAX,
          );

    await backfillOriginalSound(filtered);

    const fileIds = filtered.map((f) => f.id as string | undefined).filter(Boolean);
    const interactionsByFile = new Map<string, ReelFeedInteraction>();
    if (fileIds.length > 0) {
      const { data: batch } = await db.rpc("get_batch_interactions", {
        p_file_ids: fileIds,
        p_user_id: userId || null,
      });
      if (Array.isArray(batch)) {
        for (const row of batch) {
          if (row?.file_id) {
            const fid = fileIdKey(row.file_id);
            interactionsByFile.set(fid, {
              like_count: Number(row.like_count) ?? 0,
              dislike_count: Number(row.dislike_count) ?? 0,
              comment_count: Number(row.comment_count) ?? 0,
              user_has_liked: !!row.user_has_liked,
              user_has_disliked: !!row.user_has_disliked,
            });
          }
        }
      }
    }

    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];

    const data = filtered.map((file: Record<string, unknown>) => {
      const fid = file.id ? fileIdKey(file.id) : "";
      const interactions = fid ? interactionsByFile.get(fid) : undefined;
      const mapped = mapRpcFileToReelFeedItem(file, interactions);
      if (mapped.user_has_liked && file.id) likedFileIds.push(fileIdKey(file.id));
      if (mapped.user_has_disliked && file.id) dislikedFileIds.push(fileIdKey(file.id));
      const { user_has_liked: _l, user_has_disliked: _d, ...clientRow } = mapped;
      return clientRow;
    });

    const deliveredCount = data.length;
    const rawCountForCursor = profileModeActive && !profileExhausted ? profileRows.length : rawCount;
    /** Logged-in: keep scrolling while any reels are returned; anonymous: one page unless full batch. */
    const nextCursor =
      userId != null
        ? deliveredCount > 0 || (profileUserId && profileHasMore && !profileExhausted)
          ? { cursor_pos: 0 }
          : null
        : rawCountForCursor >= REEL_LIMIT
          ? { cursor_pos: 0 }
          : null;

    const result = {
      data,
      userActions: { likedFileIds, dislikedFileIds },
      nextCursor,
      ...(profileUserId
        ? {
            profile_exhausted: profileExhausted,
            profile_next_cursor: profileNextCursor,
            profile_has_more: profileHasMore,
          }
        : {}),
    };

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Reel-Feed-Count': String(rawCountForCursor),
        ...(contextFileId ? { 'X-Reel-Context-File': contextFileId } : {}),
        ...(profileUserId ? { 'X-Reel-Profile-User': profileUserId } : {}),
      },
    });
  } catch (error) {
    console.error('Reel feed error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
