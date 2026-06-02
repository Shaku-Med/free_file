import { logError } from "~/lib/Logging/errorLog.server";

// Receives browser-side crash reports from the global ErrorBoundary and logs
// them with a ref code the user can quote. Unauthenticated (errors happen even
// when logged out) but size-capped, sanitized, and per-IP rate-limited so it
// can't be used to spam the error_logs table.
const MAX_BODY_BYTES = 16 * 1024;
const RATE_MAX = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_CAP_ENTRIES = 5000;

// Tiny in-memory per-IP token bucket. Bounded to RATE_CAP_ENTRIES so a flood
// of unique IPs can't grow the map unbounded. Resets when window expires.
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ip = (xff.split(",")[0] || request.headers.get("x-real-ip") || "").trim();
  return ip || "unknown";
}

function checkRate(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    if (buckets.size >= RATE_CAP_ENTRIES) {
      // Cheap eviction: clear the whole map when capped (worst case: every IP
      // resets its window).
      buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= RATE_MAX) return false;
  b.count += 1;
  return true;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!checkRate(clientKey(request))) return json({ error: "rate limited" }, 429);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too large" }, 413);

  let body: { message?: unknown; stack?: unknown; url?: unknown; component?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const message = typeof body.message === "string" ? body.message.slice(0, 2000) : "client error";
  const stack = typeof body.stack === "string" ? body.stack.slice(0, 8000) : undefined;
  const url = typeof body.url === "string" ? body.url.slice(0, 512) : undefined;
  const component = typeof body.component === "string" ? body.component.slice(0, 200) : undefined;

  const ref = await logError({
    source: "client",
    message,
    error: stack ? Object.assign(new Error(message), { stack }) : undefined,
    request,
    route: url,
    context: component ? { component } : undefined,
  });

  return json({ ref });
};

// GET should not exist; return method-not-allowed so it isn't a soft page.
export const loader = () => json({ error: "method not allowed" }, 405);
