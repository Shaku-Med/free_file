import db from '~/lib/Database/supabase';
import { isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';
import { checkWatchTimeRateLimit } from '~/routes/Api/fun/personalizationRateLimit';

/** Matches watch-progress: no single asset exceeds 24h in one payload. */
const MAX_WATCH_DURATION_SECONDS = 86_400;

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({ error: 'Database not initialized' }, 500);

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ error: 'Unauthorized' }, 401);

    let body: { fileId?: string; watchDurationSeconds?: number; totalDurationSeconds?: number };
    try {
      body = await request.json();
    } catch {
      return toJson({ error: 'Invalid JSON' }, 400);
    }
    const { fileId, watchDurationSeconds, totalDurationSeconds } = body;

    if (!fileId || !isValidUUID(fileId)) return toJson({ error: 'Invalid fileId' }, 400);

    const watchDur = Number(watchDurationSeconds);
    const totalDur = Number(totalDurationSeconds);

    if (!Number.isFinite(watchDur) || watchDur < 0 || watchDur > MAX_WATCH_DURATION_SECONDS) {
      return toJson({ error: 'Invalid watchDurationSeconds' }, 400);
    }
    const totalDurSafe = Number.isFinite(totalDur) ? totalDur : 0;
    if (totalDurSafe < 0 || totalDurSafe > MAX_WATCH_DURATION_SECONDS) {
      return toJson({ error: 'Invalid totalDurationSeconds' }, 400);
    }

    const limit = checkWatchTimeRateLimit(request, user.id);
    if (!limit.allowed) {
      return toJson({ error: limit.error ?? 'Rate limited' }, 429);
    }

    const { error } = await db.rpc('record_watch_time', {
      p_user_id: user.id,
      p_file_id: fileId,
      p_watch_duration_s: watchDur,
      p_total_duration_s: totalDurSafe,
    });

    if (error) {
      console.error('record_watch_time error:', error);
      return toJson({ error: 'Failed to record watch time' }, 500);
    }

    return toJson({ success: true });
  } catch (error) {
    console.error('Watch time action error:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
