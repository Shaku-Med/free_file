/**
 * POST /api/play/mint
 *
 * Mints a short-lived LoadPlay URL bound to the requester's IP+UA.
 *
 * Why not embed the URL in the HTML / loader JSON?
 *   Anyone hitting "view source" would harvest playback URLs before
 *   a player even runs. Moving the mint to a POST endpoint with a
 *   CSRF-style custom header makes scraping require an actual browser
 *   running our JS on our origin.
 *
 * Defenses:
 *   - POST only (no `view-source:`, no link-share, no GET prefetch)
 *   - Same-origin Origin / Referer check
 *   - X-Requested-With header required (custom header → CORS preflight,
 *     which our CORS policy doesn't ack for cross-origin POSTs)
 *   - Token binds ipHash + uaHash so a leaked URL is useless off-device
 *   - Nonce auto-emitted (handled in mintLoadplayToken) so even on-device
 *     the URL locks to the first fingerprint to use it
 *   - Access control replays the watch-page check (private files require
 *     owner; deleted/missing files 404)
 */

import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import {
  buildPlaybackUrlForFile,
  hashFingerprint,
} from "~/lib/Security/loadplayToken.server";

const jsonError = (status: number) =>
  new Response(JSON.stringify({ error: "Something's wrong." }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Public origin behind the reverse proxy. `request.url` is the internal
// node URL (http://127.0.0.1:PORT) when nginx is in front, so we have
// to reconstruct from forwarded headers OR the Host header.
function expectedOrigin(request: Request): string {
  const fwdHost = request.headers.get("X-Forwarded-Host") ?? "";
  const host = request.headers.get("Host") ?? "";
  const publicHost = fwdHost || host;
  if (!publicHost) {
    try {
      return new URL(request.url).origin;
    } catch {
      return "";
    }
  }
  const fwdProto = request.headers.get("X-Forwarded-Proto") ?? "";
  const proto =
    fwdProto ||
    (request.url.startsWith("https://") ? "https" : "http");
  return `${proto}://${publicHost}`;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin") ?? "";
  const referer = request.headers.get("Referer") ?? "";
  const expected = expectedOrigin(request);
  if (!expected) return false;
  if (origin && origin !== expected) return false;
  if (!origin && !referer) return false;
  if (referer) {
    try {
      if (new URL(referer).origin !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function clientIp(request: Request): string {
  const xff = request.headers.get("X-Forwarded-For") ?? "";
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("X-Real-IP") ?? "";
}

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return jsonError(405);
  if (request.headers.get("X-Requested-With") !== "fetch") return jsonError(403);
  if (!isSameOrigin(request)) return jsonError(403);

  let body: { fileId?: unknown };
  try {
    body = (await request.json()) as { fileId?: unknown };
  } catch {
    return jsonError(400);
  }
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  if (!fileId || fileId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    return jsonError(400);
  }

  const { data: rawFile, error } = await db
    .from("files")
    .select("id,unique_id,endpoint,file_type,duration,owner_id,is_public,is_adult,github_repo")
    .eq("unique_id", fileId)
    .maybeSingle();
  if (error || !rawFile) return jsonError(404);

  const access = await checkFileAccess(
    request,
    rawFile as unknown as Parameters<typeof checkFileAccess>[1],
  );
  if (!access.allowed) return jsonError(403);

  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const userId = user?.id ?? undefined;

  const ip = clientIp(request);
  const ua = request.headers.get("User-Agent") ?? "";

  const url = buildPlaybackUrlForFile(
    {
      unique_id: rawFile.unique_id,
      endpoint: rawFile.endpoint,
      file_type: rawFile.file_type,
      duration: rawFile.duration != null ? Number(rawFile.duration) : null,
    },
    userId,
    {
      ipHash: hashFingerprint(ipPrefix(ip)),
      uaHash: hashFingerprint(ua),
    },
  );
  if (!url) return jsonError(503);

  return new Response(JSON.stringify({ url }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Never let a proxy / browser remember a minted URL.
      "Cache-Control": "no-store",
    },
  });
};

// Coarse IP bucket  must match LoadPlay's fingerprint.IPPrefix (/24 for v4, /64 for v6)
// so the LoadPlay side computes the same hash from the live request.
function ipPrefix(ip: string): string {
  const clean = ip.trim();
  if (!clean) return "";
  if (clean.includes(":")) {
    const groups = clean.split(":");
    return groups.slice(0, 4).join(":") + "::";
  }
  const parts = clean.split(".");
  if (parts.length !== 4) return "";
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

// GET → method not allowed; prevents view-source / link-share harvesting.
export const loader = () => jsonError(405);
