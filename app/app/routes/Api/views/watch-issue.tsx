import db from '~/lib/Database/supabase';
import { isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';
import { mintWatchPlaybackToken, WATCH_PLAYBACK_TOKEN_TTL_MS } from '~/routes/Api/fun/watchPlaybackTokens';
import { checkWatchIssueRateLimit } from '~/routes/Api/fun/personalizationRateLimit';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** GET /api/views/watch-issue?fileId=<uuid> — mint a one-use playback nonce for chained POSTs (no DB row). */
export const loader = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'GET') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({ error: 'Unavailable' }, 503);

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ error: 'Unauthorized' }, 401);

    const limit = checkWatchIssueRateLimit(request, user.id);
    if (!limit.allowed) {
      return toJson({ error: limit.error ?? 'Rate limited' }, 429);
    }

    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId')?.trim();
    if (!fileId || !isValidUUID(fileId)) {
      return toJson({ error: 'Invalid fileId' }, 400);
    }

    const { data: row, error } = await db.from('files').select('id').eq('id', fileId).maybeSingle();
    if (error || !row?.id) {
      return toJson({ error: 'File not found' }, 404);
    }

    const playbackToken = mintWatchPlaybackToken(user.id, row.id, request.headers);
    return toJson({
      playbackToken,
      ttlMsHint: WATCH_PLAYBACK_TOKEN_TTL_MS,
    });
  } catch (e) {
    console.error('watch-issue loader:', e);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
