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
  /** Ignored  `file_id` comes only from the consumed one-time playback token (anti‑tamper). */
  fileId?: string;
  watchDurationSeconds?: number;
  totalDurationSeconds?: number;
  /**
   * Most-replayed sampling: flat [bucket, count, bucket, count, ...] for the
   * span this heartbeat covers. Rides along with watch-time on purpose so it
   * inherits the one-time token, the auth check and the rate limit instead of
   * opening a second, softer way to write playback data.
   */
  heat?: unknown;
}

/** Mirrors playback_heat_buckets() in SQL. */
const HEAT_BUCKETS = 100;
/** One heartbeat is 15s; even at 2 samples/sec it cannot fill many buckets. */
const MAX_HEAT_PAIRS = 64;

/**
 * Shapes the client's heat report into flat pairs of finite, in-range integers.
 * Returns null when there is nothing usable. SQL clamps the counts again; this
 * is only here so obvious junk never reaches the database.
 */
function parseHeat(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length % 2 !== 0) return null;
  if (raw.length / 2 > MAX_HEAT_PAIRS) return null;
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const bucket = Number(raw[i]);
    const count = Number(raw[i + 1]);
    if (!Number.isInteger(bucket) || bucket < 0 || bucket >= HEAT_BUCKETS) continue;
    if (!Number.isFinite(count) || count <= 0) continue;
    out.push(bucket, Math.min(Math.round(count), 1000));
  }
  return out.length > 0 ? out : null;
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
      /** Token/session mismatch  treat like replay / cross-user sniff. */
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

    // Best effort and deliberately after the watch-time write: a bad heat
    // payload must never cost the user their watch time or their next token.
    const heat = parseHeat(body.heat);
    if (heat) {
      const { error: heatErr } = await db.rpc('record_playback_heat', {
        p_file_id: fileId,
        p_buckets: heat,
      });
      if (heatErr) console.warn('record_playback_heat:', heatErr.message ?? heatErr);
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
