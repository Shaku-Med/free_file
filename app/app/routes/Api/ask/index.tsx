import { isAuthenticated } from '~/lib/Security/Password';
import { assertSafeRequest } from '~/lib/Security/requestGuard.server';
import { isSameOrigin } from '~/lib/Security/sameOrigin.server';
import { validateRequestSignature, readBodyForSigning } from '~/lib/Security/requestSignature.server';
import { getCookie } from '~/lib/Security/Token';
import { rateLimiter } from '~/routes/Auth/fun/rateLimit.server';
import { ASK_MESSAGES } from '~/lib/askMessages';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUESTION = 500;
const MAX_SOURCES = 5;
const MAX_SOURCE_TITLE = 200;
const MAX_SOURCE_URL = 500;
const MAX_SEARCH_TEXT = 200;
const UPSTREAM_TIMEOUT_MS = 75_000;
const MAX_STREAM_BYTES = 256 * 1024;
const MAX_LINE_BYTES = 16 * 1024;
const MAX_ANSWER_CHARS = 6000;
// Newer uploads use 32 hex characters; older ones around 20 letters and digits.
const UNIQUE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CHAT_ID_RE = /^[a-f0-9]{32}$/;
const SOURCE_HOST = 'en.wikipedia.org';
const UNAVAILABLE = ASK_MESSAGES.unavailable;
const BUSY = ASK_MESSAGES.busy;
const MAX_WAIT_SECONDS = 120;

type Source = { title: string; url: string };
type StreamEvent =
  | { t: 'c'; v: string }
  | { t: 'w'; n: number }
  | { t: 's'; v: string }
  | { t: 'r'; sources: Source[] }
  | { t: 'd'; v: string }
  | { t: 'cut' }
  | { t: 'done' }
  | { t: 'err'; v: string; retry?: number };

/** Seconds to wait, as GoUpload reports them; anything odd reads as none. */
const waitSeconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_WAIT_SECONDS ? value : null;

const toJson = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || [...text].length > max) return null;
  return text;
}

/** The chat itself lives on GoUpload, so only its id travels, never past messages. */
function parseBody(raw: unknown): { uniqueId: string; question: string; conversationId?: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const uniqueId = typeof body.uniqueId === 'string' ? body.uniqueId : '';
  if (!UNIQUE_ID_RE.test(uniqueId)) return null;
  const question = cleanText(body.question, MAX_QUESTION);
  if (!question) return null;
  const chat = body.conversationId;
  if (chat === undefined || chat === null || chat === '') return { uniqueId, question };
  if (typeof chat !== 'string' || !CHAT_ID_RE.test(chat)) return null;
  return { uniqueId, question, conversationId: chat };
}

const plain = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text && text.length <= max ? text : null;
};

/** Sources are links the viewer can open, so only plain https Wikipedia articles pass. */
function readSource(raw: unknown): Source | null {
  if (!raw || typeof raw !== 'object') return null;
  const { title, url } = raw as Record<string, unknown>;
  const name = plain(title, MAX_SOURCE_TITLE);
  if (!name || typeof url !== 'string' || url.length > MAX_SOURCE_URL) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== SOURCE_HOST || u.port || u.username || u.password) return null;
  if (!u.pathname.startsWith('/wiki/') || u.search || u.hash) return null;
  return { title: name, url: u.toString() };
}

/** Only known event shapes pass through, rebuilt rather than forwarded. */
function readEvent(line: string): StreamEvent | null {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (!ev || typeof ev !== 'object') return null;
  const { t, v, n, sources } = ev as Record<string, unknown>;
  if (t === 'd' && typeof v === 'string' && v) return { t: 'd', v };
  if (t === 'c' && typeof v === 'string' && CHAT_ID_RE.test(v)) return { t: 'c', v };
  if (t === 'w') {
    const secs = waitSeconds(n);
    return secs ? { t: 'w', n: secs } : null;
  }
  if (t === 's') {
    const q = plain(v, MAX_SEARCH_TEXT);
    return q ? { t: 's', v: q } : null;
  }
  if (t === 'r' && Array.isArray(sources)) {
    const list = sources.slice(0, MAX_SOURCES).map(readSource).filter((x): x is Source => !!x);
    return list.length ? { t: 'r', sources: list } : null;
  }
  if (t === 'cut') return { t: 'cut' };
  if (t === 'done') return { t: 'done' };
  if (t === 'err') {
    const retry = v === 'busy' ? waitSeconds(n) : null;
    return retry ? { t: 'err', v: BUSY, retry } : { t: 'err', v: UNAVAILABLE };
  }
  return null;
}

/** Relays GoUpload's answer stream line by line, with caps on size and time. */
function relay(upstream: ReadableStream<Uint8Array>, abort: AbortController, timer: ReturnType<typeof setTimeout>) {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let bytes = 0;
  let chars = 0;
  let finished = false;

  const stop = () => {
    clearTimeout(timer);
    abort.abort();
  };

  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const send = (ev: StreamEvent) => ctrl.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
      const end = (ev?: StreamEvent) => {
        if (ev) send(ev);
        finished = true;
        stop();
        ctrl.close();
      };
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timer);
          if (!finished) end({ t: 'err', v: UNAVAILABLE });
          return;
        }
        bytes += value.byteLength;
        if (bytes > MAX_STREAM_BYTES) return end({ t: 'err', v: UNAVAILABLE });
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const ev = readEvent(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          if (!ev) continue;
          if (ev.t === 'done' || ev.t === 'err') return end(ev);
          if (ev.t === 'd') {
            chars += ev.v.length;
            if (chars > MAX_ANSWER_CHARS) {
              send({ t: 'cut' });
              return end({ t: 'done' });
            }
          }
          send(ev);
        }
        if (buffer.length > MAX_LINE_BYTES) end({ t: 'err', v: UNAVAILABLE });
      } catch {
        if (!finished) end({ t: 'err', v: UNAVAILABLE });
      }
    },
    cancel() {
      finished = true;
      stop();
      void reader.cancel().catch(() => {});
    },
  });
}

/** POST /api/ask: a signed-in viewer asks about a public video. GoUpload decides which videos qualify. */
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);

    const blocked = assertSafeRequest(request, { apiFetchOnly: true });
    if (blocked) return blocked;
    if (!isSameOrigin(request)) return toJson({ error: 'Forbidden' }, 403);

    const base = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || '').replace(/\/$/, '');
    const secret = process.env.UPLOAD_WEBHOOK_SECRET || '';
    if (!base || !secret) return toJson({ error: UNAVAILABLE }, 503);

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ error: ASK_MESSAGES.signIn }, 401);

    const declared = Number(request.headers.get('content-length') || '0');
    if (declared > MAX_BODY_BYTES) return toJson({ error: 'Too long' }, 413);

    const cookieValue = getCookie('c_user', request.headers);
    if (!cookieValue) return toJson({ error: 'Unauthorized' }, 401);
    const body = await readBodyForSigning(request);
    if (body.bytes.length > MAX_BODY_BYTES) return toJson({ error: 'Too long' }, 413);
    const sig = validateRequestSignature(request, { cookieValue, bodyBytes: body.bytes });
    if (!sig.valid) {
      const stale =
        sig.reason === 'stale_ts' || sig.reason === 'hmac_mismatch' || sig.reason === 'missing_sig_headers';
      return toJson({ error: 'Forbidden' }, 401, stale ? { 'X-Sig-Stale': '1' } : undefined);
    }

    const limit = await rateLimiter.checkLimit(String(user.id), 'api-ask', 8, 60_000, 5 * 60_000);
    if (!limit.allowed) {
      return toJson({ error: ASK_MESSAGES.tooFast }, 429);
    }

    let parsed: ReturnType<typeof parseBody>;
    try {
      parsed = parseBody(body.json());
    } catch {
      parsed = null;
    }
    if (!parsed) return toJson({ error: 'Invalid request' }, 400);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), UPSTREAM_TIMEOUT_MS);
    // A viewer who leaves or presses stop ends the model call too.
    request.signal?.addEventListener('abort', () => abort.abort(), { once: true });
    let res: Response;
    try {
      res = await fetch(`${base}/internal/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },
        body: JSON.stringify({ ...parsed, userId: String(user.id) }),
        signal: abort.signal,
      });
    } catch {
      clearTimeout(timer);
      return toJson({ error: UNAVAILABLE }, 502);
    }

    const streaming = res.ok && (res.headers.get('content-type') || '').startsWith('application/x-ndjson');
    if (!streaming || !res.body) {
      clearTimeout(timer);
      // GoUpload's own small JSON error, bounded anyway.
      const raw = res.status === 429 || res.status === 503 ? (await res.text().catch(() => '')).slice(0, 2048) : '';
      if (!raw) void res.body?.cancel().catch(() => {});
      let code: unknown;
      let retryAfter: number | null = null;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        code = parsed.error;
        retryAfter = waitSeconds(parsed.retry_after);
      } catch {
        code = null;
      }
      if (res.status === 404) return toJson({ error: ASK_MESSAGES.notAskable }, 404);
      if (res.status === 503 && code === 'busy' && retryAfter) {
        return toJson({ error: BUSY, retryAfter }, 503, { 'Retry-After': String(retryAfter) });
      }
      if (res.status === 429 && code === 'too_fast') {
        return toJson({ error: ASK_MESSAGES.oneAtATime }, 429);
      }
      if (res.status === 429) return toJson({ error: ASK_MESSAGES.dailyCap }, 429);
      return toJson({ error: UNAVAILABLE }, 502);
    }

    return new Response(relay(res.body, abort, timer), {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        // no-transform keeps the compression middleware from buffering the stream.
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    console.error('ask action:', e);
    return toJson({ error: 'Internal server error' }, 500);
  }
};

export const loader = () => toJson({ error: 'Method not allowed' }, 405);
