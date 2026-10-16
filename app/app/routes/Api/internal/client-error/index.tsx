import { logError } from "~/lib/Logging/errorLog.server";
import { rateLimiter, RateLimiter } from "~/routes/Auth/fun/rateLimit.server";

// Receives browser-side crash reports from the global ErrorBoundary and logs
// them with a ref code the user can quote. Unauthenticated (errors happen even
// when logged out) but size-capped, sanitized, and per-IP rate-limited so it
// can't be used to spam the error_logs table.
const MAX_BODY_BYTES = 16 * 1024;
const RATE_MAX = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Trusted resolver, not the raw X-Forwarded-For a client can rewrite per request.
  const limit = await rateLimiter.checkLimit(RateLimiter.getClientIP(request), "client-error", RATE_MAX, RATE_WINDOW_MS, RATE_WINDOW_MS);
  if (!limit.allowed) return json({ error: "rate limited" }, 429);

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
