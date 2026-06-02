import db from "~/lib/Database/supabase";
import { randomBytes, createHash } from "node:crypto";

// Server-side error logger. Mints a short ref_code, stores sanitized detail in
// error_logs, and returns the code so the caller can show it to the user. Best
// effort: logging never throws and never blocks the response.
//
// Per project rules: clients only ever see "Something's wrong." + the ref; the
// real message/stack stays server-side.

// No ambiguous chars (0/O, 1/I) so users can read the code back accurately.
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newRefCode(len = 8): string {
  const b = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += REF_ALPHABET[b[i] % REF_ALPHABET.length];
  return out;
}

// Strip query strings (they can carry tokens / presigned signatures) and clip length.
function clip(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  const str = typeof value === "string" ? value : String(value);
  const redacted = str.replace(/\?[^\s"']*/g, "?<redacted>");
  return redacted.length > max ? redacted.slice(0, max) : redacted;
}

function ipHash(request?: Request): string | undefined {
  if (!request) return undefined;
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ip = (xff.split(",")[0] || request.headers.get("x-real-ip") || "").trim();
  if (!ip) return undefined;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function routeOf(request?: Request, fallback?: string): string | undefined {
  if (fallback) return fallback;
  if (!request) return undefined;
  try {
    return new URL(request.url).pathname;
  } catch {
    return undefined;
  }
}

export interface LogErrorInput {
  error?: unknown;
  message?: string;
  source?: string;
  route?: string;
  method?: string;
  status?: number;
  request?: Request;
  userId?: string | null;
  context?: Record<string, unknown>;
}

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Logs an error and returns its ref code. Always resolves (never throws). */
export async function logError(input: LogErrorInput): Promise<string> {
  const ref = newRefCode();
  // In dev: console only. We can see the real error there + saving wastes DB space.
  if (isDev()) {
    const message =
      input.message ??
      (input.error instanceof Error
        ? input.error.message
        : typeof input.error === "string"
        ? input.error
        : "Unknown error");
    console.error(`[error ref=${ref}] (dev, not persisted) ${input.source ?? "app"} :: ${message}`);
    return ref;
  }
  try {
    const err = input.error;
    const message =
      input.message ??
      (err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error");
    const stack = err instanceof Error ? err.stack : undefined;

    const detail: Record<string, unknown> = {};
    if (stack) detail.stack = clip(stack, 8000);
    if (input.context) {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.context)) {
        if (k.length > 64) continue;
        if (typeof v === "number" || typeof v === "boolean") safe[k] = v;
        else safe[k] = clip(v, 1000);
      }
      detail.context = safe;
    }

    const req = input.request;
    const row = {
      ref_code: ref,
      level: "error",
      source: clip(input.source ?? "app", 64),
      message: clip(message, 2000) ?? "Unknown error",
      detail: Object.keys(detail).length ? detail : null,
      route: clip(routeOf(req, input.route), 512),
      method: clip(input.method ?? req?.method, 12),
      status: typeof input.status === "number" ? input.status : null,
      user_id: input.userId ?? null,
      ip_hash: ipHash(req),
      user_agent: clip(req?.headers.get("user-agent"), 512),
    };

    if (db) {
      const { error } = await db.from("error_logs").insert(row);
      if (error) {
        console.error("[errorLog] insert failed:", error.message ?? error, "ref=", ref);
      }
    }
    // Always echo to stdout with the ref + timestamp so box-level logs are
    // searchable even if the DB insert failed.
    console.error(`[error ref=${ref}] ${row.source} ${row.route ?? ""} :: ${row.message}`);
  } catch (e) {
    console.error("[errorLog] logging threw:", e, "ref=", ref);
  }
  return ref;
}

/** Standard opaque body for client responses, carrying the ref to report. */
export function genericErrorBody(ref: string): { error: string; ref: string } {
  return { error: "Something's wrong.", ref };
}
