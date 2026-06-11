/**
 * Server-side query embedding for semantic search.
 *
 * App -> GoUpload /internal/embed (X-Webhook-Secret, server-to-server only)
 * -> EmbedAPI sidecar on the private docker network. The secret and the
 * vector never touch the client; the browser only ever sees search results.
 *
 * Fail-soft by design: any error returns null and search runs lexical-only.
 * An in-memory LRU keeps popular queries ("cat", trending terms) at zero
 * cost  1000 users typing the same word = 1 embed call.
 */

const EMBED_TIMEOUT_MS = 2000;
const CACHE_MAX = 500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type CacheEntry = { vector: number[]; expires: number };

// Map preserves insertion order: delete+set on hit = LRU.
const cache = new Map<string, CacheEntry>();

function uploadServerBase(): string {
  const raw = process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || '';
  return raw.replace(/\/$/, '');
}

function cacheGet(key: string): number[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.vector;
}

function cacheSet(key: string, vector: number[]): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { vector, expires: Date.now() + CACHE_TTL_MS });
}

/** Vector as pgvector text literal ('[0.1,0.2,...]') or null when disabled/down. */
export async function embedSearchQuery(query: string): Promise<string | null> {
  const base = uploadServerBase();
  const secret = process.env.UPLOAD_WEBHOOK_SECRET || '';
  if (!base || !secret) return null;

  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  if (!normalized) return null;

  const cached = cacheGet(normalized);
  if (cached) return `[${cached.join(',')}]`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/internal/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret,
      },
      body: JSON.stringify({ texts: [normalized], kind: 'query' }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { vectors?: number[][] };
    const vector = json?.vectors?.[0];
    if (!Array.isArray(vector) || vector.length !== 384 || !vector.every((v) => Number.isFinite(v))) {
      return null;
    }
    cacheSet(normalized, vector);
    return `[${vector.join(',')}]`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
