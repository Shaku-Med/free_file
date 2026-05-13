import { getCookie } from "~/lib/Security/Token";
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import { sanitizeFilePath } from "~/lib/Security/inputValidation";
import {
  verifySegmentToken,
  verifyGuestSegmentToken,
  rewriteM3U8,
  restrictHlsMasterPlaylistToLowestRendition,
  sessionRateKey,
  GUEST_SEGMENT_TOKEN_TTL_SEC,
  SIGNED_IN_SEGMENT_TOKEN_TTL_SEC,
} from "~/lib/Services/SegmentTokenService";
import {
  recordSegmentFetch,
  recordManifestFetch,
  segmentRetryAfterSeconds,
} from "~/lib/Services/SegmentRateLimiter";
import {
  videoRequestGuard,
  getAllowedOrigin,
} from "~/lib/Security/Server/videoRequestGuard";
import { truncateHlsMediaPlaylistAtDuration } from "~/lib/Services/hlsPlaylistTruncate";
import { computeGuestPreviewSeconds } from "~/lib/guestPreviewLimit";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import {
  defaultGithubBranch,
  defaultGithubRepoForStoredFile,
  githubRawFileUrl,
  resolveGithubRepoForFile,
} from "~/lib/githubStorage";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import {
  createPendingManifestKey,
  tryConsumeManifestKey,
  verifyManifestContinuationCookie,
} from "~/lib/Services/hlsManifestGate.server";
import { uniqueIdCandidatesFromVideoStoragePath } from "~/lib/Services/videoStoragePath.server";

const getFileFromPath = async (path: string) => {
  if (!db) return null;
  for (const uniqueId of uniqueIdCandidatesFromVideoStoragePath(path)) {
    const { data } = await db
      .from("files")
      .select("id, is_adult, is_public, owner_id, github_repo, duration")
      .eq("unique_id", uniqueId)
      .maybeSingle();
    if (data) return data;
  }
  return null;
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
  let manifestGateSetCookie: string | null = null;
  try {
    const url = new URL(request.url);

    /**
     * Browser-set Sec-Fetch headers reject pasted-in-tab and most curl/ffmpeg rips.
     * For top-level navigations (address bar, "open in new tab" from devtools, link click
     * to a `.ts`/`.m3u8` URL) we bounce to the homepage instead of returning a `403`. That
     * way the URL doesn't look like a standalone resource that exists — the user lands on
     * the app instead of seeing a "Forbidden" status. HLS.js fetches don't hit this branch.
     */
    if (!videoRequestGuard(request)) {
      const sfMode = request.headers.get("sec-fetch-mode");
      const sfUser = request.headers.get("sec-fetch-user");
      const isTopLevelNavigation =
        sfMode === "navigate" || sfUser === "?1" || sfMode === null;
      if (isTopLevelNavigation) {
        const home = new URL("/", url.origin).toString();
        return new Response(null, {
          status: 302,
          headers: {
            Location: home,
            /** Don't let intermediaries cache the redirect itself per-URL. */
            "Cache-Control": "private, no-store",
          },
        });
      }
      return new Response(null, { status: 403 });
    }

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

    const ext = sanitizedPath.split(".").pop()?.toLowerCase();
    const isPlaylistManifest = ext === "m3u8" || ext === "m2u8";
    const isSegment = ext === "ts";

    /**
     * Velocity throttle. A real player pulls segments at ~real-time pace; an
     * extension piping URLs to ffmpeg pulls them as fast as the network can
     * handle. We cap segment + manifest fetches per session+IP, which is the
     * one defense extensions can't beat by forwarding browser-set headers
     * (the request is real, the *rate* of requests is the tell).
     */
    const rk = sessionRateKey(request.headers);
    if (isSegment || isPlaylistManifest) {
      const ok = isSegment ? recordSegmentFetch(rk) : recordManifestFetch(rk);
      let headerCheck = () => {
        try {
          const referer = request.headers.get("referer");
          if(!referer || referer.trim().length < 1) return false;
          return true;
        } catch {
          return false;
        }
      }
      if(!headerCheck()) return new Response(null, { status: 403 });
      if (!ok) {
        return new Response(null, {
          status: 429,
          headers: {
            "Retry-After": String(isSegment ? segmentRetryAfterSeconds(rk) : 30),
          },
        });
      }
    }

    const verified = await VKF(request);
    const user = await isAuthenticated(request, ["id"]);
    const userId = user?.id ?? null;

    const file = await getFileFromPath(sanitizedPath);
    if (file) {
      const accessControl = await checkFileAccess(request, file);
      if (!accessControl.allowed) {
        return new Response(null, { status: 403 });
      }
    }

    if (!verified && !userId) {
      // Signed-out: only allow paths we can authorize (file row + access).
      if (!file) return new Response(null, { status: 401 });
    }
    // Signed-in without VKF (`token` cookie): session is from `c_user`; segment/manifest gates still apply.

    const guestMode = !userId;
    const playbackKind = guestMode ? "guest" : "user";

    /** Same value as HLS truncation + playlist tokens; never from query/body (prevents URL tampering). */
    const guestPreviewLimitSeconds = guestMode
      ? file &&
        file.duration != null &&
        Number.isFinite(Number(file.duration)) &&
        Number(file.duration) > 0
        ? computeGuestPreviewSeconds(Number(file.duration))
        : computeGuestPreviewSeconds(0)
      : null;

    if (isSegment) {
      const st = url.searchParams.get("_st");
      if (!st) {
        return new Response(null, { status: 403 });
      }
      if (guestMode) {
        if (
          guestPreviewLimitSeconds == null ||
          !verifyGuestSegmentToken(
            st,
            sanitizedPath,
            request.headers,
            guestPreviewLimitSeconds
          )
        ) {
          return new Response(null, { status: 403 });
        }
      } else if (!verifySegmentToken(st, sanitizedPath, request.headers)) {
        return new Response(null, { status: 403 });
      }
    }

    if (isPlaylistManifest) {
      const st = url.searchParams.get("_st");
      if (st) {
        if (guestMode) {
          if (
            guestPreviewLimitSeconds == null ||
            !verifyGuestSegmentToken(
              st,
              sanitizedPath,
              request.headers,
              guestPreviewLimitSeconds
            )
          ) {
            return new Response(null, { status: 403 });
          }
        } else if (!verifySegmentToken(st, sanitizedPath, request.headers)) {
          return new Response(null, { status: 403 });
        }
      }

      const mk = url.searchParams.get("_mk");
      if (mk) {
        const consumed = tryConsumeManifestKey(
          mk,
          sanitizedPath,
          request.headers,
          playbackKind
        );
        if (!consumed) {
          return new Response(null, { status: 403 });
        }
        manifestGateSetCookie = consumed.setCookieHeader;
      } else {
        const cookieOk = verifyManifestContinuationCookie(
          request.headers.get("Cookie"),
          sanitizedPath,
          request.headers,
          playbackKind
        );
        if (!cookieOk) {
          return new Response(null, { status: 403 });
        }
      }
    }

    const owner = process.env.GITHUB_OWNER;
    if (!owner) {
      console.error("GITHUB_OWNER is not set");
      return new Response(null, { status: 500 });
    }
    const repo = file ? resolveGithubRepoForFile(file) : defaultGithubRepoForStoredFile();
    const branch = defaultGithubBranch();
    const videoUrl = githubRawFileUrl(owner, repo, branch, sanitizedPath);
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error("Fetch failed");

    const origin = getAllowedOrigin(url, request.headers);

    /** Align with `_st` lifetime so the browser can reuse responses without re-hitting the origin. */
    const segmentCacheMaxAge = guestMode
      ? GUEST_SEGMENT_TOKEN_TTL_SEC
      : SIGNED_IN_SEGMENT_TOKEN_TTL_SEC;

    /**
     * Manifests embed a one-time `_mk` and may differ guest vs signed-in (truncated vs full HLS),
     * so they must not be cached. Segments are addressed by `_st` token (session + path bound) —
     * `max-age` matches token TTL (browser cache never outlives validity).
     */
    const videoResponseCacheHeaders: Record<string, string> = isSegment
      ? {
          "Cache-Control": `private, max-age=${segmentCacheMaxAge}`,
          "Vary": "Origin, Cookie",
          "Cross-Origin-Resource-Policy": "same-origin",
        }
      : {
          "Cache-Control": "private, no-store, max-age=0, must-revalidate",
          Pragma: "no-cache",
          "Vary": "Origin, Cookie",
          "Cross-Origin-Resource-Policy": "same-origin",
        };

    if (isPlaylistManifest) {
      let raw = await response.text();
      const basePath = sanitizedPath.substring(
        0,
        sanitizedPath.lastIndexOf("/")
      );
      const isMasterPlaylist =
        raw.includes("#EXT-X-STREAM-INF") ||
        raw.includes("#EXT-X-I-FRAME-STREAM-INF");
      if (guestMode && isMasterPlaylist) {
        raw = restrictHlsMasterPlaylistToLowestRendition(raw);
      }
      let rewritten = rewriteM3U8(raw, basePath, request.headers, {
        guestMode,
        guestLimitSeconds: guestPreviewLimitSeconds ?? undefined,
        mintChildManifestKey:
          isMasterPlaylist
            ? (childPath) =>
                createPendingManifestKey(childPath, request.headers, playbackKind)
            : undefined,
      });
      if (guestMode && guestPreviewLimitSeconds != null && guestPreviewLimitSeconds > 0) {
        rewritten = truncateHlsMediaPlaylistAtDuration(
          rewritten,
          guestPreviewLimitSeconds
        );
      }

      const h: Record<string, string> = {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        ...videoResponseCacheHeaders,
        "X-Content-Type-Options": "nosniff",
      };
      if (manifestGateSetCookie) {
        h["Set-Cookie"] = manifestGateSetCookie;
      }
      return new Response(rewritten, {
        status: 200,
        headers: h,
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
        ...videoResponseCacheHeaders,
        "X-Content-Type-Options": "nosniff",
        /**
         * `inline` (not `attachment`) — HLS.js fetches don't read this header, but if a
         * response somehow leaks to a non-fetch context, browsers won't auto-show the
         * Save As dialog. Pair with `noindex` so search bots never archive segment URLs.
         */
        ...(isSegment
          ? {
              "Content-Disposition": 'inline; filename="seg.ts"',
              "X-Robots-Tag": "noindex, noarchive, nofollow",
            }
          : {}),
      },
    });
  } catch (error) {
    console.error("Error loading video:", error);
    return new Response(null, { status: 500 });
  }
};
