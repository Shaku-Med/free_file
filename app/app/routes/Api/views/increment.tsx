import db from '~/lib/Database/supabase';
import { isValidFileId, isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';
import { canAccessFile } from '~/routes/Api/fun/accessControl';
import { rateLimiter, RateLimiter } from '~/routes/Auth/fun/rateLimit';
import crypto from 'node:crypto';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ── Rate limit config ──────────────────────────────────────────
// Per-IP: max 60 view increments per minute (covers all files combined).
// A real user watching reels might hit ~2-4/min; 60 is generous but stops bots.
const VIEW_RATE_MAX = 60;
const VIEW_RATE_WINDOW_MS = 60 * 1000;
const VIEW_RATE_BLOCK_MS = 10 * 60 * 1000; // 10 min block

// Per-user global: max 200 views per hour across all files
const VIEW_USER_RATE_MAX = 200;
const VIEW_USER_RATE_WINDOW_MS = 60 * 60 * 1000;
const VIEW_USER_RATE_BLOCK_MS = 30 * 60 * 1000;

// ── Max values to reject obviously spoofed payloads ──────────
const MAX_CURRENT_TIME_S = 86_400; // 24 hours  no video is longer
const MAX_DURATION_S = 86_400;

function getClientIP(request: Request): string {
  // Use RateLimiter's shared implementation for consistency
  return RateLimiter.getClientIP(request);
}

/**
 * Build a viewer_key that is hard to spoof.
 *
 * For authenticated users: deterministic hash of user_id (user can't forge a different key).
 * For anonymous: hash of IP + truncated UA prefix (first 120 chars only, so minor
 * UA tweaks like version bumps don't create new keys, but big rotations still do).
 *
 * We hash to keep keys a fixed length and avoid leaking raw IPs into the DB.
 */
function buildViewerKey(userId: string | null | undefined, ip: string, ua: string): string {
  if (userId) {
    return `user:${userId}`;
  }
  // Use only the first 120 chars of UA to reduce trivial rotation
  const uaPrefix = (ua || 'unknown').slice(0, 120);
  const raw = `${ip}::${uaPrefix}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  return `anon:${hash}`;
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({ error: 'Something went wrong.' }, 500);

    // ── Rate limit: per-IP ──────────────────────────────────────
    const ip = getClientIP(request);
    const ipLimit = rateLimiter.checkLimit(ip, 'api-views-ip', VIEW_RATE_MAX, VIEW_RATE_WINDOW_MS, VIEW_RATE_BLOCK_MS);
    if (!ipLimit.allowed) {
      return toJson({ error: ipLimit.error ?? 'Too many requests' }, 429);
    }

    let body: { fileId?: string; uniqueId?: string; currentTimeSeconds?: number; durationSeconds?: number };
    try {
      body = await request.json();
    } catch {
      return toJson({ error: 'Invalid JSON' }, 400);
    }
    const { fileId, uniqueId, currentTimeSeconds, durationSeconds } = body;

    if (!fileId && !uniqueId) return toJson({ error: 'fileId or uniqueId is required' }, 400);
    if (fileId && !isValidUUID(fileId)) return toJson({ error: 'Invalid fileId format' }, 400);
    if (uniqueId && !isValidFileId(uniqueId)) return toJson({ error: 'Invalid uniqueId format' }, 400);

    let fileQuery = db
      .from('files')
      .select('id, views, view_count, duration, file_type, is_adult, is_public, visibility, owner_id, upload_status');
    if (fileId) fileQuery = fileQuery.eq('id', fileId);
    else fileQuery = fileQuery.eq('unique_id', uniqueId);
    const { data: file, error: fileError } = await fileQuery.single();
    if (fileError || !file) return toJson({ error: 'File not found' }, 404);

    // Gate on access so view counts can't be inflated on private / age-gated
    // files by anyone who knows the id or unique_id.
    const allowed = await canAccessFile(request, file as any);
    if (!allowed) return toJson({ error: 'File not found' }, 404);

    const user = await isAuthenticated(request, ['id']);

    // ── Rate limit: per-user (if authenticated) ─────────────────
    if (user?.id) {
      const userLimit = rateLimiter.checkLimit(user.id, 'api-views-user', VIEW_USER_RATE_MAX, VIEW_USER_RATE_WINDOW_MS, VIEW_USER_RATE_BLOCK_MS);
      if (!userLimit.allowed) {
        return toJson({ error: userLimit.error ?? 'Too many requests' }, 429);
      }
    }

    const ua = request.headers.get('user-agent') ?? 'unknown';
    const viewerKey = buildViewerKey(user?.id, ip, ua);

    // ── Clamp and validate numeric inputs ───────────────────────
    const ct = Number(currentTimeSeconds);
    const dur =
      durationSeconds != null
        ? Number(durationSeconds)
        : file.duration != null
          ? Number(file.duration)
          : 0;

    // Reject obviously spoofed values
    let safeCt = Number.isFinite(ct) && ct >= 0 && ct <= MAX_CURRENT_TIME_S ? ct : 0;
    const safeDur = Number.isFinite(dur) && dur >= 0 && dur <= MAX_DURATION_S ? dur : 0;

    // Server-side sanity: currentTime shouldn't exceed duration by a large margin.
    // Legitimate players can overshoot slightly (buffering), but not by 2x.
    // Silently clamp rather than reject  could be a quirky player, not necessarily a bot.
    if (safeDur > 0 && safeCt > safeDur * 1.5) {
      safeCt = safeDur;
    }

    const { data: rpcData, error: rpcErr } = await db.rpc('increment_file_view_if_eligible', {
      p_file_id: file.id,
      p_user_id: user?.id ?? null,
      p_viewer_key: viewerKey,
      p_current_time_s: safeCt,
      p_duration_s: safeDur,
      p_file_type: String(file.file_type ?? ''),
    });

    if (rpcErr) {
      console.error('increment_file_view_if_eligible:', rpcErr);
      return toJson({ error: 'Failed to increment views' }, 500);
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const counted = Boolean(row?.counted);
    const views = Number(row?.views ?? file.views ?? 0);
    const view_count = Number(row?.view_count ?? file.view_count ?? 0);

    return toJson({ success: true, views, view_count, counted }, 200);
  } catch (error) {
    console.error('Error in views increment action:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
