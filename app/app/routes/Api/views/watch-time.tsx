import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { checkWatchTimeRateLimit } from '~/routes/Api/fun/personalizationRateLimit';
import {
  consumeWatchPlaybackToken,
  mintWatchPlaybackToken,
  sanitizeAcceptedWatchSeconds,
} from '~/routes/Api/fun/watchPlaybackTokens';

/** Matches watch-progress: no single asset exceeds 24h in one payload. */
const MAX_WATCH_DURATION_SECONDS = 86_400;

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

interface WatchTimeBody {
  playbackToken?: string;
  /** Ignored — `file_id` comes only from the consumed one-time playback token (anti‑tamper). */
  fileId?: string;
  watchDurationSeconds?: number;
  totalDurationSeconds?: number;
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({ error: 'Database not initialized' }, 500);

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ error: 'Unauthorized' }, 401);

    let body: WatchTimeBody;
    try {
      body = await request.json();
    } catch {
      return toJson({ error: 'Invalid JSON' }, 400);
    }

    const playbackTokenRaw = typeof body.playbackToken === 'string' ? body.playbackToken.trim() : '';
    if (!playbackTokenRaw) {
      return toJson({ error: 'playbackToken required', code: 'missing_playback_token' }, 400);
    }

    const watchDurRaw = Number(body.watchDurationSeconds);
    let totalDur = Number(body.totalDurationSeconds);

    if (!Number.isFinite(watchDurRaw) || watchDurRaw < 0 || watchDurRaw > MAX_WATCH_DURATION_SECONDS) {
      return toJson({ error: 'Invalid watchDurationSeconds' }, 400);
    }
    totalDur = Number.isFinite(totalDur) ? totalDur : 0;
    if (totalDur < 0 || totalDur > MAX_WATCH_DURATION_SECONDS) {
      return toJson({ error: 'Invalid totalDurationSeconds' }, 400);
    }

    const consumed = consumeWatchPlaybackToken(playbackTokenRaw, request.headers);
    if (!consumed) {
      return toJson({ error: 'Invalid or expired playback token', code: 'invalid_playback_token' }, 409);
    }
    if (consumed.userId !== user.id) {
      /** Token/session mismatch — treat like replay / cross-user sniff. */
      return toJson({ error: 'Session mismatch', code: 'playback_token_mismatch' }, 403);
    }

    const fileId = consumed.fileId;

    const watchDur = sanitizeAcceptedWatchSeconds(user.id, fileId, watchDurRaw);

    const limit = checkWatchTimeRateLimit(request, user.id);
    if (!limit.allowed) {
      return toJson({ error: limit.error ?? 'Rate limited' }, 429);
    }

    const { error } = await db.rpc('record_watch_time', {
      p_user_id: user.id,
      p_file_id: fileId,
      p_watch_duration_s: watchDur,
      p_total_duration_s: totalDur,
    });

    if (error) {
      console.error('record_watch_time error:', error);
      return toJson({ error: 'Failed to record watch time' }, 500);
    }

    const nextPlaybackToken = mintWatchPlaybackToken(user.id, fileId, request.headers);

    return toJson({
      success: true,
      nextPlaybackToken,
    });
  } catch (error) {
    console.error('Watch time action error:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
