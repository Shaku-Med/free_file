import db from '~/lib/Database/supabase';
import { isValidFileId, isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Upserts user_watch_history for the signed-in viewer (one row per user+file; rewatches update last_viewed_at).
 * Separate from /api/views/increment (public view counts). Call when the watch page loads.
 */
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({ recorded: false }, 200);

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ recorded: false }, 200);

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
