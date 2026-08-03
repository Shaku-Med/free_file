import db from "~/lib/Database/supabase";
import { canAccessFile } from "~/routes/Api/fun/accessControl";
import {
  defaultGithubBranch,
  githubRawFileUrl,
  resolveGithubRepoForFile,
} from "~/lib/githubStorage";
import { isR2Configured, r2PresignGet } from "~/lib/r2.server";

// GET /api/load/preview/<storage path> — hover preview mp4.
// Mirrors the LoadNodeServer route so the relative URL works either way.

const PREVIEW_FILENAME = "hover_preview.mp4";

function pathFromRequest(request: Request): string {
  const { pathname } = new URL(request.url);
  const prefix = "/api/load/preview/";
  const i = pathname.indexOf(prefix);
  if (i === -1) return "";
  return decodeURIComponent(pathname.slice(i + prefix.length)).replace(/^\/+/, "");
}

// Without this the route reads arbitrary objects out of storage.
function isPreviewPath(path: string): boolean {
  if (!path || path.length > 512) return false;
  if (path.includes("..") || path.includes("\\") || path.startsWith("/")) return false;
  if (!path.endsWith("/" + PREVIEW_FILENAME)) return false;
  return path.split("/").length > 2;
}

const deny = (status = 404) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const path = pathFromRequest(request);
    if (!isPreviewPath(path) || !db) return deny();

    const uniqueId = path.split("/")[1];
    if (!uniqueId) return deny();

    const { data: file } = await db
      .from("files")
      .select(
        "id, is_adult, is_public, visibility, owner_id, upload_status, github_repo, storage_backend",
      )
      .eq("unique_id", uniqueId)
      .maybeSingle();
    if (!file) return deny();

    const status = String(file.upload_status ?? "").trim().toLowerCase();
    if (status && status !== "complete" && status !== "completed") return deny();

    // 404 rather than 403 so the endpoint never confirms a file exists to
    // someone who may not see it.
    if (!(await canAccessFile(request, file as any))) return deny();

    let upstream: string | null = null;
    if (file.storage_backend === "r2") {
      if (!isR2Configured()) return deny(503);
      upstream = r2PresignGet(path);
    } else {
      const owner = process.env.GITHUB_OWNER ?? "";
      if (!owner) return deny(503);
      upstream = githubRawFileUrl(
        owner,
        resolveGithubRepoForFile(file as { github_repo?: string | null }),
        defaultGithubBranch(),
        path,
      );
    }
    if (!upstream) return deny();

    const res = await fetch(upstream);
    if (!res.ok) return deny();
    const body = await res.arrayBuffer();

    // Only fully public, non-adult previews may sit in a shared cache.
    const shareable =
      file.is_adult !== true &&
      (file.visibility === "public" || (file.visibility == null && file.is_public === true));

    return new Response(body, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(body.byteLength),
        "Cache-Control": shareable
          ? "public, max-age=604800, immutable"
          : "private, no-store",
        "Accept-Ranges": "none",
      },
    });
  } catch (e) {
    console.error("[api/load/preview]", e);
    return deny(500);
  }
};
