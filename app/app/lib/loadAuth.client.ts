import { IMAGE_BASE_URL } from "~/lib/URLS";

export type LoadAuthContext = {
  bearer: string;
  base: string;
};

let cached: { ctx: LoadAuthContext; expiresAt: number } | null = null;
let inFlight: Promise<LoadAuthContext | null> | null = null;

/**
 * Mints a short-lived load-scoped bearer from the HttpOnly c_user cookie
 * (server-side via /api/load/auth). Used as `Authorization: Bearer …` when
 * fetching adult/private media from LoadNodeServer.
 */
export async function fetchLoadAuthContext(): Promise<LoadAuthContext | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + 30_000) {
    return cached.ctx;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const authRes = await fetch("/api/load/auth", {
        credentials: "include",
        headers: { "X-Requested-With": "fetch" },
      });
      if (!authRes.ok) return null;

      const json = (await authRes.json()) as {
        bearer?: string;
        load_server_url?: string;
        expires_in?: number;
      };
      const bearer = json.bearer?.trim();
      const base = (json.load_server_url || IMAGE_BASE_URL).replace(/\/$/, "");
      if (!bearer || !base) return null;

      const ttlMs = Math.max(60, Number(json.expires_in) || 3600) * 1000;
      const ctx: LoadAuthContext = { bearer, base };
      cached = { ctx, expiresAt: now + ttlMs };
      return ctx;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function clearLoadAuthCache(): void {
  cached = null;
}

/** Headers for authenticated LoadNode fetches (adult / private). */
export async function loadAuthHeaders(): Promise<HeadersInit> {
  const ctx = await fetchLoadAuthContext();
  if (!ctx?.bearer) return {};
  return { Authorization: `Bearer ${ctx.bearer}` };
}
