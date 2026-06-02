import { config } from "~/lib/config";
import db from "~/lib/Database/supabase";
import { validGitHubRepoName } from "~/lib/profilePicSecurity.server";
import { r2PresignGet } from "~/lib/r2.server";

/** Align with Go `IsValidUsername`: first path segment when path is `{username}/{uuid}.ext`. */
const USERNAME_FIRST_SEGMENT = /^[a-zA-Z0-9_-]{3,30}$/;

const PROFILE_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|gif|webp)$/i;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const ALLOWED_CT = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function normalizeProfilePicPath(path: string): string | null {
  try {
    const decoded = decodeURIComponent(path).replace(/\\/g, "/").trim();
    const collapsed = decoded.replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!collapsed || collapsed.includes("..")) return null;
    const segments = collapsed.split("/").filter(Boolean);
    if (segments.length !== 2 || segments.some((s) => s.startsWith(".") || s === "..")) return null;
    if (!USERNAME_FIRST_SEGMENT.test(segments[0]) || !PROFILE_FILE.test(segments[1])) return null;
    return segments.join("/");
  } catch {
    return null;
  }
}

function profilePicPathVariantsForDb(canonical: string): string[] {
  return [...new Set([canonical, `/${canonical}`])];
}

function sameProfilePicStoragePath(dbValue: string | null | undefined, canonical: string): boolean {
  if (dbValue == null || typeof dbValue !== "string") return false;
  const norm = (s: string) =>
    s.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/+$/, "").trim();
  return norm(dbValue) === canonical;
}

function sniffImageContentType(buf: ArrayBuffer): string | null {
  if (buf.byteLength < 12) return null;
  const u = new Uint8Array(buf);
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return "image/jpeg";
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return "image/png";
  if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x38) return "image/gif";
  if (
    u[0] === 0x52 &&
    u[1] === 0x49 &&
    u[2] === 0x46 &&
    u[3] === 0x46 &&
    u[8] === 0x57 &&
    u[9] === 0x45 &&
    u[10] === 0x42 &&
    u[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function resolveContentType(buf: ArrayBuffer, headerValue: string | null): string | null {
  const raw = (headerValue || "").split(";")[0].trim().toLowerCase();
  if (ALLOWED_CT.has(raw)) return raw;
  return sniffImageContentType(buf);
}

interface ProfilePicStorage {
  repo: string | null;
  backend: "github" | "r2";
}

async function resolveProfilePicStorage(pathCanon: string): Promise<ProfilePicStorage> {
  if (!db) return { repo: null, backend: "github" };

  const variants = profilePicPathVariantsForDb(pathCanon);
  const { data: rows, error: inErr } = await db
    .from("users")
    .select("github_repo, storage_backend")
    .in("profile_pic", variants)
    .limit(1);

  if (inErr) {
    console.error("[profilepic load] users by profile_pic:", inErr);
  }
  if (rows?.[0]) {
    const backend = rows[0].storage_backend === "r2" ? "r2" : "github";
    if (backend === "r2") return { repo: null, backend: "r2" };
    const r0 = typeof rows[0].github_repo === "string" ? rows[0].github_repo.trim() : "";
    if (r0 && validGitHubRepoName(r0)) return { repo: r0, backend: "github" };
  }

  const firstSeg = pathCanon.split("/")[0] ?? "";
  if (!USERNAME_FIRST_SEGMENT.test(firstSeg)) return { repo: null, backend: "github" };

  const { data: byUser, error: userErr } = await db
    .from("users")
    .select("github_repo, profile_pic, storage_backend")
    .eq("username", firstSeg)
    .maybeSingle();

  if (userErr) {
    console.error("[profilepic load] users by username:", userErr);
    return { repo: null, backend: "github" };
  }
  if (!byUser || !sameProfilePicStoragePath(byUser.profile_pic, pathCanon)) {
    return { repo: null, backend: "github" };
  }
  if (byUser.storage_backend === "r2") return { repo: null, backend: "r2" };
  const r1 = typeof byUser.github_repo === "string" ? byUser.github_repo.trim() : "";
  if (r1 && validGitHubRepoName(r1)) return { repo: r1, backend: "github" };
  return { repo: null, backend: "github" };
}

function uniqueRepoOrder(userRepo: string | null, envRepo: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (r: string) => {
    const t = r.trim();
    if (!t || seen.has(t) || !validGitHubRepoName(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (userRepo) add(userRepo);
  add(envRepo);
  add("Memories");
  return out;
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const rawPath = url.pathname.split("/api/load/profilepic/")[1];
    const path = rawPath ? normalizeProfilePicPath(rawPath) : null;
    if (!path) {
      return new Response(null, { status: 400 });
    }

    const storage = await resolveProfilePicStorage(path);

    // Candidate fetch URLs in priority order. R2 is a single presigned URL;
    // GitHub tries the user repo then env/legacy fallbacks.
    const urls: string[] = [];
    if (storage.backend === "r2") {
      const signed = r2PresignGet(path);
      if (signed) urls.push(signed);
    } else {
      if (!config.github.token || !config.github.owner) {
        return new Response(null, { status: 503 });
      }
      const envRepo = config.github.repo.trim();
      for (const repo of uniqueRepoOrder(storage.repo, envRepo)) {
        urls.push(`https://raw.githubusercontent.com/${config.github.owner}/${repo}/main/${path}`);
      }
    }

    for (const fetchUrl of urls) {
      const response = await fetch(fetchUrl);
      if (!response.ok) continue;

      const cl = response.headers.get("content-length");
      const clParsed = cl ? parseInt(cl, 10) : NaN;
      if (Number.isFinite(clParsed) && clParsed > MAX_IMAGE_BYTES) {
        continue;
      }

      const imageBuffer = await response.arrayBuffer();
      if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
        continue;
      }

      const contentType = resolveContentType(imageBuffer, response.headers.get("content-type"));
      if (!contentType) {
        continue;
      }

      return new Response(imageBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          // Cache for 3h. Updates flip the avatar cache-key on the client
          // (?cb=N changes), so the URL changes and the new pic is fetched
          // straight away  no stale-content risk.
          "Cache-Control": "public, max-age=10800",
          "X-Content-Type-Options": "nosniff",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response(null, { status: 404 });
  } catch (error) {
    console.error("Error loading profile picture:", error);
    return new Response(null, { status: 500 });
  }
};
