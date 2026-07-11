import db from '~/lib/Database/supabase';
import { isValidFileId, isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';
import { rateLimiter, RateLimiter } from '~/routes/Auth/fun/rateLimit';

/** Hard upper bound on stored timestamps (24h). Matches the SQL function's CHECK ceiling. */
const MAX_TIMESTAMP_SECONDS = 86_400;
/** Server-side guardrail: client throttles to one save per 10s, so this is generous headroom. */
const MAX_SAVES_PER_WINDOW = 60;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_BLOCK_MS = 5 * 60 * 1000;

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const MAX_BULK_FILE_IDS = 200;

/**
 * GET /api/watch-progress?fileIds=idOrUnique1,idOrUnique2,...
 *
 * Bulk fetch playback positions for the signed-in viewer for a set of files
 * (used by feed/grid pages to populate the YouTube-style progress bars).
 * Accepts both DB UUIDs (`files.id`) and public ids (`files.unique_id`) so grids that only
 * selected one of them still get watch progress. Returns progress keyed by whichever id(s)
 * the caller provided.
 * Guests get an empty map (no error).
 */
export const loader = async ({ request }: { request: Request }) => {
  if (request.method !== 'GET') return toJson({}, 405);
  if (!db) return toJson({}, 500);

  const user = await isAuthenticated(request, ['id']);
  if (!user?.id) return toJson({}, 401);

  const url = new URL(request.url);
  const raw = url.searchParams.get('fileIds')?.trim();
  if (!raw) return toJson({ progress: {} }, 200);

  const requestedIds = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (requestedIds.length === 0) return toJson({ progress: {} }, 200);
  if (requestedIds.length > MAX_BULK_FILE_IDS) {
    return toJson({ error: `Too many fileIds (max ${MAX_BULK_FILE_IDS})` }, 400);
  }

  const uuidIds = requestedIds.filter((s) => isValidUUID(s));
  const uniqueIds = requestedIds.filter((s) => isValidFileId(s));
  if (uuidIds.length === 0 && uniqueIds.length === 0) return toJson({ progress: {} }, 200);

  const fileIdByUniqueId = new Map<string, string>();
  const uniqueIdByFileId = new Map<string, string>();
  const resolvedFileIds = new Set<string>();

  if (uuidIds.length > 0) {
    for (const id of uuidIds) resolvedFileIds.add(id);
  }
  if (uniqueIds.length > 0) {
    const { data: resolveRows, error: resolveErr } = await db
      .from('files')
      .select('id, unique_id')
      .in('unique_id', uniqueIds);
    if (resolveErr) {
      console.error('watch-progress resolve unique ids:', resolveErr);
    } else {
      for (const row of (resolveRows as Array<{ id: string; unique_id: string }> | null) ?? []) {
        resolvedFileIds.add(row.id);
        fileIdByUniqueId.set(row.unique_id, row.id);
        uniqueIdByFileId.set(row.id, row.unique_id);
      }
    }
  }
  if (resolvedFileIds.size === 0) return toJson({ progress: {} }, 200);

  const { data, error } = await db.rpc('get_user_watch_progress', {
    p_user_id: user.id,
    p_file_ids: Array.from(resolvedFileIds),
  });

  if (error) {
    console.error('get_user_watch_progress:', error);
    return toJson({ progress: {} }, 200);
  }

  const progress: Record<
    string,
    { currentTime: number; duration: number; updatedAt: string }
  > = {};
  for (const row of (data as Array<{ file_id: string; current_time_s: number; duration_s: number; updated_at: string }>) ?? []) {
    const entry = {
      currentTime: Number(row.current_time_s) || 0,
      duration: Number(row.duration_s) || 0,
      updatedAt: row.updated_at,
    };
    progress[row.file_id] = entry;
    const uniqueId = uniqueIdByFileId.get(row.file_id);
    if (uniqueId) progress[uniqueId] = entry;
  }

  // Ensure each caller key resolves back to whichever identifier it requested.
  for (const req of requestedIds) {
    if (progress[req]) continue;
    if (isValidUUID(req)) {
      const uniqueId = uniqueIdByFileId.get(req);
      if (uniqueId && progress[uniqueId]) progress[req] = progress[uniqueId];
      continue;
    }
    const fileId = fileIdByUniqueId.get(req);
    if (fileId && progress[fileId]) progress[req] = progress[fileId];
  }

  return toJson({ progress }, 200);
};

/**
 * POST /api/watch-progress
 * Body: { fileId?: uuid, uniqueId?: string, currentTime: number, duration: number }
 *
 * Upserts the signed-in viewer's playback position for one file. Throttled by the caller
 * (`usePlaybackPosition`)  the server does not rate-limit since each viewer touches one
 * row at a time. Guests get 401 — the hook keeps its IndexedDB save path regardless.
 */
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({}, 500);

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({}, 401);

    let body: {
      fileId?: string;
      uniqueId?: string;
      currentTime?: number;
      duration?: number;
    };
    try {
      body = await request.json();
    } catch {
      return toJson({ error: 'Invalid JSON' }, 400);
    }

    const { fileId, uniqueId, currentTime, duration } = body;

    if (!fileId && !uniqueId) return toJson({ error: 'fileId or uniqueId is required' }, 400);
    if (fileId && !isValidUUID(fileId)) return toJson({ error: 'Invalid fileId format' }, 400);
    if (uniqueId && !isValidFileId(uniqueId)) return toJson({ error: 'Invalid uniqueId format' }, 400);

    const ct = Number(currentTime);
    const dur = Number(duration);
    if (!Number.isFinite(ct) || ct < 0 || ct > MAX_TIMESTAMP_SECONDS) {
      return toJson({ error: 'Invalid currentTime' }, 400);
    }
    if (!Number.isFinite(dur) || dur < 0 || dur > MAX_TIMESTAMP_SECONDS) {
      return toJson({ error: 'Invalid duration' }, 400);
    }

    /**
     * Server-side rate limit. The hook already throttles to one save per 10s of timeupdate,
     * so a legitimate viewer comes nowhere near 60 saves/min. A misbehaving client gets a
     * 429 + 5-minute block. Keyed per user (or IP for guests, though guests get rejected
     * earlier  defense in depth).
     */
    const rateKey = user.id || `ip:${RateLimiter.getClientIP(request)}`;
    const limit = rateLimiter.checkLimit(
      rateKey,
      'watch-progress',
      MAX_SAVES_PER_WINDOW,
      RATE_WINDOW_MS,
      RATE_BLOCK_MS,
    );
    if (!limit.allowed) {
      return toJson({ saved: false, error: limit.error ?? 'Rate limited' }, 429);
    }

    let q = db.from('files').select('id');
    if (fileId) q = q.eq('id', fileId);
    else q = q.eq('unique_id', uniqueId);
    const { data: fileRow, error: fileErr } = await q.maybeSingle();
    if (fileErr || !fileRow?.id) return toJson({ saved: false }, 200);

    const { error: rpcErr } = await db.rpc('upsert_user_watch_progress', {
      p_user_id: user.id,
      p_file_id: fileRow.id,
      p_current_time: ct,
      p_duration: dur,
    });
    if (rpcErr) {
      console.error('upsert_user_watch_progress:', rpcErr);
      return toJson({ saved: false, error: 'Failed to save' }, 500);
    }

    return toJson({ saved: true }, 200);
  } catch (error) {
    console.error('watch-progress action:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
