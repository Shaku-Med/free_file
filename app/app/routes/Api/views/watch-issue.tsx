import db from '~/lib/Database/supabase';
import { isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';
import { assertSafeRequest } from '~/lib/Security/requestGuard.server';
import { validateRequestSignature, readBodyForSigning } from '~/lib/Security/requestSignature.server';
import { getCookie } from '~/lib/Security/Token';
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

    // Layer 1: blocks Postman / curl / cross-site cookie replay.
    const blocked = assertSafeRequest(request);
    if (blocked) return blocked;

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ error: 'Unauthorized' }, 401);

    // Layer 2: blocks stolen-cookie replay from non-browser contexts.
    // The signing key is only obtainable via /api/handshake/sig-key,
    // which itself is browser-gated. Postman with a stolen cookie can't
    // sign requests because it can't get the key.
    const cookieValue = getCookie('c_user', request.headers);
    if (!cookieValue) return toJson({ error: 'Unauthorized' }, 401);
    const body = await readBodyForSigning(request);
    const sig = validateRequestSignature(request, {
      cookieValue,
      bodyBytes: body.bytes,
    });
    if (!sig.valid) {
      // Tell the client to refresh its key on `stale_ts` — usually a
      // browser tab that opened before the master secret rotated.
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (sig.reason === 'stale_ts') headers.set('X-Sig-Stale', '1');
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 401,
        headers,
      });
    }

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
