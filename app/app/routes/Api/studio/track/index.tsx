import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isAnalyticsSchemaAvailable } from "~/lib/studio/analyticsDaily.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

const ALLOWED_EVENTS = new Set([
  "video_view",
  "video_complete",
  "profile_view",
  "share",
  "save",
  "search_query",
]);

interface IncomingEvent {
  type?: unknown;
  fileId?: unknown;
  ownerId?: unknown;
  metadata?: unknown;
}

// POST /api/studio/track — batched event ingestion. Body: { events: [...] }.
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") return denyErr(405);
    if (!db) return denyErr(503);

    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    const actorId = user?.id ?? null;

    let body: { events?: unknown };
    try {
      body = (await request.json()) as { events?: unknown };
    } catch {
      return denyErr(400);
    }

    const incoming = Array.isArray(body.events) ? (body.events as IncomingEvent[]) : [];
    if (incoming.length === 0 || incoming.length > 50) {
      return denyErr(400);
    }

    // Resolve owner_id for each fileId in one batched query. This is the
    // only fan out we do; the rest is in memory mapping.
    const fileIds = Array.from(
      new Set(
        incoming
          .map((e) => (typeof e.fileId === "string" ? e.fileId : null))
          .filter((x): x is string => Boolean(x && x.length <= 64 && /^[A-Za-z0-9_-]+$/.test(x))),
      ),
    );
    let fileOwners = new Map<string, { id: string; owner_id: string }>();
    if (fileIds.length > 0) {
      const { data: files } = await db.from("files").select("id, owner_id").in("id", fileIds);
      for (const row of (files ?? []) as Array<{ id: string; owner_id: string }>) {
        fileOwners.set(row.id, row);
      }
    }

    const xff = request.headers.get("X-Forwarded-For") ?? "";
    const ip = (xff.split(",")[0] || request.headers.get("X-Real-IP") || "").trim();
    const ua = request.headers.get("User-Agent") ?? "";
    const anonHash = await sha256Hex(ip + "|" + ua).catch(() => "");

    const rows = incoming
      .map((e) => {
        const type = typeof e.type === "string" ? e.type : "";
        if (!ALLOWED_EVENTS.has(type)) return null;

        const fileId = typeof e.fileId === "string" ? e.fileId : null;
        // Owner is ALWAYS the server-resolved file owner. Never trust a
        // client-supplied ownerId (it could attribute events to any account).
        const resolvedOwner = fileId ? fileOwners.get(fileId)?.owner_id : null;
        const ownerId = typeof resolvedOwner === "string" ? resolvedOwner : null;

        const meta =
          e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
            ? (e.metadata as Record<string, unknown>)
            : {};
        // Strip anything that looks risky from metadata; only allow
        // primitive scalars and short strings.
        const safeMeta: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(meta)) {
          if (k.length > 32) continue;
          if (typeof v === "number" && Number.isFinite(v)) safeMeta[k] = v;
          else if (typeof v === "boolean") safeMeta[k] = v;
          else if (typeof v === "string" && v.length <= 256) safeMeta[k] = v;
        }

        return {
          event_type: type,
          file_id: fileId,
          owner_id: ownerId,
          actor_id: actorId,
          actor_anon_hash: anonHash || null,
          metadata: safeMeta,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (rows.length === 0) return toJson({ success: true, accepted: 0 });

    if (!(await isAnalyticsSchemaAvailable())) {
      return toJson({ success: true, accepted: 0 });
    }

    const { error } = await db.from("analytics_events").insert(rows);
    if (error) {
      console.error("[studio/track] insert", error);
      return denyErr(500);
    }

    return toJson({ success: true, accepted: rows.length });
  } catch (e) {
    console.error("[studio/track] unexpected", e);
    return denyErr(500);
  }
};

async function sha256Hex(input: string): Promise<string> {
  if (!input) return "";
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export const loader = () => denyErr(405);
