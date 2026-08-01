/**
 * POST /api/play/cast-mint
 *
 * Mints a cast-scoped LoadPlay URL so a Chromecast / Cast device can fetch the
 * stream itself. Unlike /api/play/mint (bound to the browser's IP+UA+nonce),
 * the TV has no browser Origin/Referer and a different UA, so a normal playback
 * URL gets rejected by loadplay. This endpoint mints a token that is:
 *   - NOT IP-bound: dual-stack networks route the browser over IPv6 and the
 *     Chromecast over IPv4, so a browser-IP bind 401s the TV's first fetch
 *   - NOT UA-bound (the TV's user-agent differs)
 *   - flagged `cast` so loadplay skips its browser-origin guard for it
 *   - fresh-nonce + longer TTL (a whole movie), so it locks to the TV on first
 *     use and can't be replayed from another network after that
 *
 * Signed-in only  guests don't get cast URLs. The MINT request itself still
 * goes through the same browser-only guards as /api/play/mint (POST,
 * X-Requested-With, same-origin) so only our JS can ask for one.
 */

import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import { buildCastUrlForFile } from "~/lib/Security/loadplayToken.server";

const jsonError = (status: number) =>
  new Response(JSON.stringify({ error: "Something's wrong." }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
  const proto = fwdProto || (request.url.startsWith("https://") ? "https" : "http");
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

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return jsonError(405);
  if (request.headers.get("X-Requested-With") !== "fetch") return jsonError(403);
  if (!isSameOrigin(request)) return jsonError(403);

  // Cast is a signed-in feature.
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const userId = user?.id;
  if (!userId) return jsonError(401);

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
    .select("id,unique_id,endpoint,file_type,duration,owner_id,is_public,visibility,is_adult,github_repo")
    .eq("unique_id", fileId)
    .maybeSingle();
  if (error || !rawFile) return jsonError(404);

  const access = await checkFileAccess(
    request,
    rawFile as unknown as Parameters<typeof checkFileAccess>[1],
  );
  if (!access.allowed) return jsonError(403);

  const url = buildCastUrlForFile(
    {
      unique_id: rawFile.unique_id,
      endpoint: rawFile.endpoint,
      file_type: rawFile.file_type,
    },
    userId,
    request,
  );
  if (!url) return jsonError(503);

  return new Response(JSON.stringify({ url }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};

// GET → method not allowed; prevents view-source / link-share harvesting.
export const loader = () => jsonError(405);
