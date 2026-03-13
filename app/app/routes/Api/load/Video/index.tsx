import { getCookie } from "~/lib/Security/Token";
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import { sanitizeFilePath } from "~/lib/Security/inputValidation";
import {
  verifySegmentToken,
  rewriteM3U8,
} from "~/lib/Services/SegmentTokenService";
import db from "~/lib/Database/supabase";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";

const getFileFromPath = async (path: string) => {
  if (!db) return null;
  const pathParts = path.split("/");
  const uniqueId = pathParts.length > 2 ? pathParts[1] : pathParts[0];
  const { data } = await db
    .from("files")
    .select("id, is_adult, is_public, owner_id")
    .eq("unique_id", uniqueId)
    .maybeSingle();
  return data || null;
};

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

export const loader = async ({ request }: { request: Request }) => {
  try {
    const verified = await VKF(request);
    if (!verified) return new Response(null, { status: 401 });

    const url = new URL(request.url);
    const pathAfterPrefix = url.pathname.split("/api/load/video/")[1];
    if (!pathAfterPrefix) return new Response(null, { status: 400 });

    let filePath = pathAfterPrefix;
    try {
      if (filePath.includes("%")) filePath = decodeURIComponent(filePath);
    } catch {
      return new Response(null, { status: 400 });
    }

    const sanitizedPath = sanitizeFilePath(filePath);
    if (!sanitizedPath) return new Response(null, { status: 400 });

    const file = await getFileFromPath(sanitizedPath);
    if (file) {
      const accessControl = await checkFileAccess(request, file);
      if (!accessControl.allowed) {
        return new Response(null, { status: 403 });
      }
    }

    const ext = sanitizedPath.split(".").pop()?.toLowerCase();
    const isM3U8 = ext === "m3u8";
    const isSegment = ext === "ts";

    if (isSegment) {
      const st = url.searchParams.get("_st");
      if (!st || !verifySegmentToken(st, sanitizedPath, request.headers)) {
        return new Response(null, { status: 403 });
      }
    }

    if (isM3U8) {
      const st = url.searchParams.get("_st");
      if (st && !verifySegmentToken(st, sanitizedPath, request.headers)) {
        return new Response(null, { status: 403 });
      }
    }

    const videoUrl = `https://github.com/${process.env.GITHUB_OWNER}/Memories/raw/main/${sanitizedPath}`;
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error("Fetch failed");

    const origin = url.origin;

    if (isM3U8) {
      const raw = await response.text();
      const basePath = sanitizedPath.substring(
        0,
        sanitizedPath.lastIndexOf("/")
      );
      const rewritten = rewriteM3U8(raw, basePath, request.headers);
      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Vary": "Origin",
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const body = new Uint8Array(await response.arrayBuffer());
    const contentType = isSegment ? "video/mp2t" : "application/octet-stream";

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
        "Cache-Control": isSegment
          ? "private, max-age=300"
          : "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error loading video:", error);
    return new Response(null, { status: 500 });
  }
};
