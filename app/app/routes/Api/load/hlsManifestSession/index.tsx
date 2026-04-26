import { getCookie } from "~/lib/Security/Token";
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import { sanitizeFilePath } from "~/lib/Security/inputValidation";
import { verifyHlsBootstrap, type HlsPlaybackKind } from "~/lib/Security/Server/hlsBootstrap.server";
import { createPendingManifestKey } from "~/lib/Services/hlsManifestGate.server";
import {
  evaluateVideoRequestGuard,
  getAllowedOrigin,
} from "~/lib/Security/Server/videoRequestGuard";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import { uniqueIdFromVideoStoragePath } from "~/lib/Services/videoStoragePath.server";

/** TEMP: remove after HTTPS / 403 production debug — logs which branch failed (no secrets). */
const DBG = "[hls-manifest-session]";

const VKF = async (request: Request) => {
  try {
    const keys = ["token1", "token2"];
    const token = getCookie("token", request.headers);
    if (!token) return null;
    const decoded = await VerifyToken(
      { token, addedKeyNames: keys },
      request.headers
    );
    return decoded ? true : null;
  } catch {
    return null;
  }
};

const getFileFromPath = async (path: string) => {
  if (!db) return null;
  const uniqueId = uniqueIdFromVideoStoragePath(path);
  if (!uniqueId) return null;
  const { data } = await db
    .from("files")
    .select("id, is_adult, is_public, owner_id, github_repo, duration")
    .eq("unique_id", uniqueId)
    .maybeSingle();
  return data || null;
};

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const guard = evaluateVideoRequestGuard(request);
  if (!guard.ok) {
    console.warn(`${DBG} 403 videoRequestGuard`, guard.reason);
    return new Response(null, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }

  const bootstrap = typeof body.bootstrap === "string" ? body.bootstrap : "";
  const rawPath =
    typeof body.manifestPath === "string" ? body.manifestPath : "";
  if (!bootstrap || !rawPath) {
    return new Response(null, { status: 400 });
  }

  let manifestPath = rawPath;
  try {
    if (manifestPath.includes("%")) manifestPath = decodeURIComponent(manifestPath);
  } catch {
    return new Response(null, { status: 400 });
  }

  const sanitizedPath = sanitizeFilePath(manifestPath);
  if (!sanitizedPath || !sanitizedPath.endsWith(".m3u8")) {
    return new Response(null, { status: 400 });
  }

  const verified = await VKF(request);
  const user = await isAuthenticated(request, ["id"]);
  const userId = user?.id ?? null;
  const file = await getFileFromPath(sanitizedPath);

  if (!verified && !userId) {
    if (!file) {
      console.warn(`${DBG} 401 guest no VKF and no file row`, {
        sanitizedPath,
        uniqueId: uniqueIdFromVideoStoragePath(sanitizedPath),
        dbConfigured: Boolean(db),
      });
      return new Response(null, { status: 401 });
    }
  } else if (!verified) {
    console.warn(`${DBG} 401 signed-in but VKF failed`, { userId: userId ?? null, sanitizedPath });
    return new Response(null, { status: 401 });
  }

  const kind: HlsPlaybackKind = userId ? "user" : "guest";
  const ok = await verifyHlsBootstrap(bootstrap, request.headers, kind, userId);
  if (!ok) {
    console.warn(`${DBG} 403 verifyHlsBootstrap failed`, {
      kind,
      userId: userId ?? null,
      bootstrapLen: bootstrap.length,
      sanitizedPath,
    });
    return new Response(null, { status: 403 });
  }

  if (file) {
    const accessControl = await checkFileAccess(request, file);
    if (!accessControl.allowed) {
      console.warn(`${DBG} 403 checkFileAccess denied`, {
        reason: accessControl.reason,
        fileId: file.id,
        sanitizedPath,
      });
      return new Response(null, { status: 403 });
    }
  } else {
    console.warn(`${DBG} 403 no file row for path`, {
      sanitizedPath,
      uniqueId: uniqueIdFromVideoStoragePath(sanitizedPath),
      dbConfigured: Boolean(db),
    });
    return new Response(null, { status: 403 });
  }

  const manifestKey = createPendingManifestKey(
    sanitizedPath,
    request.headers,
    kind
  );

  const url = new URL(request.url);
  return Response.json(
    { manifestKey, expiresInSeconds: 600 },
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": getAllowedOrigin(url),
        "Access-Control-Allow-Credentials": "true",
        "Cache-Control": "no-store",
        Vary: "Origin, Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
};
