import { getCookie } from "./Token";
import { DecryptCombine } from "./unsharedkeyEncryption/Combined/Combined";
import { getAllKeys } from "./unsharedkeyEncryption/Combined/Verification/TokenKeys";
import db from "../Database/supabase";

/** HttpOnly cookie holding inactive session JWTs (same format as c_user). */
export const ALT_ACCOUNTS_COOKIE = "ff_alt_accounts";
export const MAX_ALT_ACCOUNTS = 4;
const MAX_PIC_LEN = 300;

export type AltAccount = {
  token: string;
  id: string;
  /** username snapshot when parked */
  u: string;
  /** profile_pic storage path / URL snapshot when parked (truncated to MAX_PIC_LEN) */
  pic?: string;
};

function splitCookieValue(raw: string, name: string): string | null {
  const prefix = `${name}=`;
  const part = raw.split("; ").find((c) => c.startsWith(prefix));
  if (!part) return null;
  return part.slice(prefix.length);
}

/** Reads cookie value; supports `=` inside JWT value. */
export function readCookieRaw(name: string, headers: Headers): string | null {
  const cookie = headers.get("Cookie");
  if (!cookie) return null;
  return splitCookieValue(cookie, name);
}

function safePic(pic: unknown): string | undefined {
  if (typeof pic !== "string") return undefined;
  const t = pic.trim();
  if (!t || t.length > MAX_PIC_LEN) return undefined;
  if (t.includes("<") || t.includes(">")) return undefined;
  return t;
}

export function parseAltAccounts(cookieVal: string | null): AltAccount[] {
  if (!cookieVal) return [];
  try {
    const decoded = decodeURIComponent(cookieVal);
    const parsed = JSON.parse(decoded) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: AltAccount[] = [];
    for (const x of parsed) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      if (
        typeof o.token === "string" &&
        typeof o.id === "string" &&
        typeof o.u === "string"
      ) {
        const row: AltAccount = { token: o.token, id: o.id, u: o.u };
        const pic = safePic(o.pic);
        if (pic) row.pic = pic;
        out.push(row);
      }
    }
    return out.slice(0, MAX_ALT_ACCOUNTS);
  } catch {
    return [];
  }
}

function buildCookieString(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "Secure" : "";
  return `${ALT_ACCOUNTS_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; ${secure}; SameSite=Lax`;
}

export function appendAltAccountsCookie(headers: Headers, accounts: AltAccount[]): void {
  const trimmed = accounts.slice(-MAX_ALT_ACCOUNTS);
  const value = encodeURIComponent(JSON.stringify(trimmed));
  if (value.length > 3800) {
    let n = trimmed.length;
    while (n > 0 && encodeURIComponent(JSON.stringify(trimmed.slice(-n))).length > 3800) {
      n -= 1;
    }
    const fallback = trimmed.slice(-Math.max(1, n));
    headers.append("Set-Cookie", buildCookieString(encodeURIComponent(JSON.stringify(fallback)), 30 * 24 * 60 * 60));
    return;
  }
  headers.append("Set-Cookie", buildCookieString(value, 30 * 24 * 60 * 60));
}

export function clearAltAccountsCookie(headers: Headers): void {
  headers.append(
    "Set-Cookie",
    `${ALT_ACCOUNTS_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`
  );
}

/**
 * Re-validate a parked JWT against the DB before promoting it to the active session.
 * Returns the verified user row or null if the token is stale/revoked/banned.
 */
export async function revalidateParkedToken(
  token: string
): Promise<{ id: string; username: string; verified: boolean } | null> {
  try {
    const keys = await getAllKeys(["token1", "c_user"]);
    if (!keys) return null;
    const decoded = await DecryptCombine(token, keys);
    if (!decoded?.c_usr) return null;
    if (!db) return null;
    const { data: user, error } = await db
      .from("users")
      .select("id, username, verified, is_memories")
      .eq("c_usr", decoded.c_usr)
      .maybeSingle();
    if (error || !user) return null;
    if (user.is_memories || !user.verified) return null;
    return { id: user.id, username: user.username, verified: user.verified };
  } catch {
    return null;
  }
}

/** Park current session token into the alt list (for "add another account"). */
export function parkCurrentInVault(
  existing: AltAccount[],
  oldToken: string,
  oldUser: { id: string; username: string; profile_pic?: string | null },
  newUserId: string
): AltAccount[] {
  if (oldUser.id === newUserId) return existing;
  if (existing.some((a) => a.id === oldUser.id)) return existing;
  const parked: AltAccount = { token: oldToken, id: oldUser.id, u: oldUser.username };
  const pic = safePic(oldUser.profile_pic);
  if (pic) parked.pic = pic;
  const next: AltAccount[] = [...existing, parked];
  return next.slice(-MAX_ALT_ACCOUNTS);
}

export function readAltAccountsFromRequest(headers: Headers): AltAccount[] {
  const raw = readCookieRaw(ALT_ACCOUNTS_COOKIE, headers) ?? getCookie(ALT_ACCOUNTS_COOKIE, headers);
  return parseAltAccounts(raw);
}

/** Validate request origin matches the host (CSRF defense-in-depth for JSON endpoints). */
export function isValidOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  const host = request.headers.get("Host");
  if (!host) return false;
  const check = (url: string | null): boolean => {
    if (!url) return false;
    try {
      return new URL(url).host === host;
    } catch {
      return false;
    }
  };
  if (origin) return check(origin);
  if (referer) return check(referer);
  return false;
}

/** Server-side same-origin path validation for redirects. Prevents open-redirect attacks. */
export function safeServerRedirect(request: Request, raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.length > 500) return "/";
  try {
    const base = new URL(request.url);
    const parsed = new URL(raw, base);
    if (parsed.origin !== base.origin) return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
}
