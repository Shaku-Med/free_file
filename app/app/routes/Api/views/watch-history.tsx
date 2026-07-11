import db from '~/lib/Database/supabase';
import { isValidFileId, isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';
import { isSameOrigin } from '~/lib/Security/sameOrigin.server';
import { rateLimiter } from '~/routes/Auth/fun/rateLimit';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Wipes the signed-in viewer's watch history AND playback positions. */
async function clearHistory(request: Request) {
  if (!db) return toJson({ cleared: false }, 200);
  // Destructive: reject cross-site callers even if they carry the auth cookie.
  if (!isSameOrigin(request)) return toJson({ error: 'Forbidden' }, 403);
  const user = await isAuthenticated(request, ['id']);
  if (!user?.id) return toJson({ error: 'Unauthorized' }, 401);

  // Destructive but idempotent — still no reason to allow hammering it.
  const limit = rateLimiter.checkLimit(user.id, 'clear-watch-history', 3, 10 * 60 * 1000, 10 * 60 * 1000);
  if (!limit.allowed) return toJson({ error: limit.error ?? 'Rate limited' }, 429);

  const [historyRes, progressRes] = await Promise.all([
    db.from('user_watch_history').delete().eq('user_id', user.id),
    db.from('user_watch_progress').delete().eq('user_id', user.id),
  ]);
  if (historyRes.error || progressRes.error) {
    console.error('clear watch history:', historyRes.error ?? progressRes.error);
    return toJson({ cleared: false, error: 'Failed to clear' }, 500);
  }
  return toJson({ cleared: true }, 200);
}

/**
 * POST: upserts user_watch_history for the signed-in viewer (one row per user+file;
 * rewatches update last_viewed_at). Skipped while the user has history paused.
 * DELETE: clears the viewer's history + playback positions (Settings privacy control).
 * Separate from /api/views/increment (public view counts).
 */
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method === 'DELETE') return await clearHistory(request);
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({}, 500);

    const user = await isAuthenticated(request, ['id', 'history_paused']);
    if (!user?.id) return toJson({}, 401);
    if (user.history_paused === true) return toJson({ recorded: false, paused: true }, 200);

    let body: { fileId?: string; uniqueId?: string };
    try {
      body = await request.json();
    } catch {
      return toJson({ error: 'Invalid JSON' }, 400);
    }

    const { fileId, uniqueId } = body;
    if (!fileId && !uniqueId) return toJson({ error: 'fileId or uniqueId is required' }, 400);
    if (fileId && !isValidUUID(fileId)) return toJson({ error: 'Invalid fileId format' }, 400);
    if (uniqueId && !isValidFileId(uniqueId)) return toJson({ error: 'Invalid uniqueId format' }, 400);

    let q = db.from('files').select('id');
    if (fileId) q = q.eq('id', fileId);
    else q = q.eq('unique_id', uniqueId);
    const { data: fileRow, error: fileErr } = await q.maybeSingle();
    if (fileErr || !fileRow?.id) return toJson({ recorded: false }, 200);

    const { error: rpcErr } = await db.rpc('touch_user_watch_history', {
      p_user_id: user.id,
      p_file_id: fileRow.id,
    });
    if (rpcErr) {
      console.error('touch_user_watch_history:', rpcErr);
      return toJson({ recorded: false, error: 'Failed to record' }, 500);
    }

    return toJson({ recorded: true }, 200);
  } catch (error) {
    console.error('watch-history action:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
