import {
  data,
  Link,
  redirect,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { Button } from "~/components/ui/button";
import db from "~/lib/Database/supabase";
import Reel from "../components/Reel";
import type { FileType } from "~/lib/types";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import { BASE_URL } from "~/lib/URLS";
import {
  ParseFilename,
  getVideoSrc,
  getThumbnailUrl,
  getThumbnailPreviewApiPaths,
} from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";
import { stripGithubRepoForClient } from "~/lib/githubStorage";
import { ownerService } from "~/lib/Services/OwnerService";
import { buildPageMeta } from "~/lib/seo";
import { buildVideoObject, videoPreviewMeta } from "~/lib/seo/videoPreview";
import { isAuthenticated } from "~/lib/Security/Password";
import { sanitizeFileForPublicViewer } from "~/lib/files/sanitizeFileForViewer";
import {
  REEL_LOADER_FILE_COLUMNS,
  stripThumbnailsForClient,
} from "~/lib/files/reelFilePayload";
import { buildReelWatchPath, usernamesMatch, type ReelProfileContext } from "~/lib/reel/reelProfileContext";
import WatchModalShell from "~/components/WatchModalShell";

function fileIdKey(id: unknown): string {
  return String(id ?? "").toLowerCase();
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const routeUniqueId = params.uniqueId ?? "";
  const routeOwnerUsername = params.ownerUsername ?? null;
  try {
    if (!db) {
      throw new Error("Database not initialized");
    }

    const { data: rawFile, error } = await db
      .from("files")
      .select(REEL_LOADER_FILE_COLUMNS)
      .eq("unique_id", routeUniqueId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching reel file:", error, { routeUniqueId });
      return data(
        {
          file: null,
          uniqueId: routeUniqueId,
          accessDenied: false as const,
          reason: undefined,
          initialUserActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
          profileReelContext: null as ReelProfileContext | null,
        },
        { status: 404 },
      );
    }

    const file = rawFile
      ? (() => {
          const stripped = stripThumbnailsForClient(
            stripGithubRepoForClient(rawFile as Record<string, unknown>) as Record<string, unknown>,
          );
          return {
            ...stripped,
            like_count: Number(stripped.like_count ?? stripped.up_count) || 0,
            dislike_count: Number(stripped.dislike_count ?? stripped.down_count) || 0,
          } as typeof rawFile;
        })()
      : null;

    if (!file) {
      return data(
        {
          file: null,
          uniqueId: routeUniqueId,
          accessDenied: false as const,
          reason: undefined,
          initialUserActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
          profileReelContext: null as ReelProfileContext | null,
        },
        { status: 404 },
      );
    }

    const accessControl = await checkFileAccess(request, file);

    if (!accessControl.allowed) {
      return data(
        {
          file: null,
          uniqueId: routeUniqueId,
          accessDenied: true as const,
          reason: accessControl.reason,
          initialUserActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
          profileReelContext: null as ReelProfileContext | null,
        },
        { status: 403 },
      );
    }

    // The reel page only plays REELS. A direct /reel/:id pointing at a normal
    // video (e.g. someone hand-editing a watch URL into a reel URL) must never
    // open inside the vertical reel deck  send it to its proper watch page.
    const isReelFile =
      (file as { is_reel?: unknown }).is_reel === true ||
      (file as { is_reel?: unknown }).is_reel === 1;
    if (!isReelFile) {
      throw redirect(`/${encodeURIComponent(routeUniqueId)}`);
    }

    // Enrich file with owner information (matching feed items shape)
    const enrichedFiles = await ownerService.enrichFilesWithOwners([file]);
    let fileWithOwner = (enrichedFiles && enrichedFiles[0]) || file;

    // Sound chip: attach the matched original's display info (public only),
    // same shape the reel feed RPC returns.
    const originalFileId = (file as { original_file_id?: string | null }).original_file_id;
    if (originalFileId) {
      const { data: orig } = await db
        .from("files")
        .select("unique_id, file_title, filename, default_thumbnail, preview_endpoint, created_at, is_public, visibility, is_adult, upload_status")
        .eq("id", originalFileId)
        .maybeSingle();
      if (orig && orig.is_public === true && orig.is_adult !== true && orig.upload_status === "complete") {
        (fileWithOwner as Record<string, unknown>).original_sound = {
          unique_id: String(orig.unique_id),
          file_title: orig.file_title ?? null,
          filename: orig.filename ?? null,
          default_thumbnail: orig.default_thumbnail ?? null,
          created_at: orig.created_at ?? null,
        };
      }
    }

    const user = await isAuthenticated(request, ["id"]);
    const userId = user?.id || undefined;
    let initialUserActions: { likedFileIds: string[]; dislikedFileIds: string[] } = {
      likedFileIds: [],
      dislikedFileIds: [],
    };

    if (db && userId && fileWithOwner?.id) {
      const { data: batch } = await db.rpc("get_batch_interactions", {
        p_file_ids: [fileWithOwner.id],
        p_user_id: userId,
      });
      const row = Array.isArray(batch) ? batch[0] : null;
      if (row && typeof row === "object" && "file_id" in row) {
        const rpcLike = Number(fileWithOwner.like_count ?? (fileWithOwner as { up_count?: unknown }).up_count) || 0;
        const rpcDislike =
          Number(fileWithOwner.dislike_count ?? (fileWithOwner as { down_count?: unknown }).down_count) || 0;
        const rpcComment = Number(fileWithOwner.comment_count) || 0;
        const likeCount = Math.max(Number(row.like_count) || 0, rpcLike);
        const dislikeCount = Math.max(Number(row.dislike_count) || 0, rpcDislike);
        const commentCount = Math.max(Number(row.comment_count) || 0, rpcComment);
        const liked = !!row.user_has_liked;
        const disliked = !!row.user_has_disliked;
        const idKey = fileIdKey(fileWithOwner.id);
        if (liked) initialUserActions.likedFileIds.push(idKey);
        if (disliked) initialUserActions.dislikedFileIds.push(idKey);
        fileWithOwner = {
          ...fileWithOwner,
          like_count: likeCount,
          dislike_count: dislikeCount,
          comment_count: commentCount,
        };
      }
    }

    const fileOut = stripThumbnailsForClient(
      sanitizeFileForPublicViewer(
        fileWithOwner as unknown as Record<string, unknown>,
        userId ?? null,
      ) as Record<string, unknown>,
    ) as typeof fileWithOwner;

    let profileReelContext: ReelProfileContext | null = null;
    if (routeOwnerUsername) {
      const ownerUsername = fileWithOwner.owner?.username;
      const ownerId = fileWithOwner.owner_id ?? fileWithOwner.owner?.id;
      if (
        !ownerUsername ||
        !ownerId ||
        !usernamesMatch(ownerUsername, decodeURIComponent(routeOwnerUsername))
      ) {
        throw redirect(buildReelWatchPath(routeUniqueId));
      }
      profileReelContext = { userId: String(ownerId), username: ownerUsername };
    }

    return data(
      {
        file: fileOut,
        uniqueId: routeUniqueId,
        accessDenied: false as const,
        reason: undefined,
        initialUserActions,
        profileReelContext,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Error in reel dynamic loader:", error);
    return data(
      {
        file: null,
        uniqueId: routeUniqueId,
        accessDenied: false as const,
        reason: undefined,
        initialUserActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
        profileReelContext: null as ReelProfileContext | null,
      },
      { status: 500 },
    );
  }
};

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  try {
    if (!loaderData || !loaderData.file) {
      const title = loaderData?.accessDenied
        ? "Access Denied | Memories"
        : "Reel Not Found | Memories";
      const description = loaderData?.accessDenied
        ? "You do not have permission to view this reel."
        : "Reel not found";
      return buildPageMeta({
        title,
        description,
        canonicalPath: loaderData?.uniqueId ? `/reel/${encodeURIComponent(loaderData.uniqueId)}` : "/reel",
        noindex: true,
      });
    }

    const file = loaderData.file as FileType;
    const displayTitle =
      file.file_title && file.file_title.trim() !== ""
        ? file.file_title
        : ParseFilename(file.filename || "");
    const likesCount = Number((file as any).up_count || 0);
    const commentsCount = Number((file as any).comments_count || 0);
    const viewsCount = Number((file as any).views || (file as any).view_count || 0);
    const sharesCount = Number((file as any).shares || (file as any).share_count || 0);
    const statsParts: string[] = [];
    if (viewsCount > 0) statsParts.push(`${formatNumber(viewsCount)} views`);
    if (likesCount > 0) statsParts.push(`${likesCount} ${likesCount === 1 ? "like" : "likes"}`);
    if (sharesCount > 0) statsParts.push(`${formatNumber(sharesCount)} shares`);
    if (commentsCount > 0) statsParts.push(`${commentsCount} ${commentsCount === 1 ? "comment" : "comments"}`);
    const statsText = statsParts.join(" • ");
    const displayDescription =
      file.file_description && file.file_description.trim() !== ""
        ? `${file.file_description} | ${statsText}`
        : `${ParseFilename(file.filename || "")} | ${statsText} | ${file.file_type} | ${file.file_size}`;

    const isVideo =
      file.file_type?.includes("video") ||
      file.file_type === "application/vnd.apple.mpegurl" ||
      file.endpoint?.includes(".m3u8");
    const isImage = file.file_type?.startsWith("image/");
    const ogType = isVideo ? "video.other" : isImage ? "image" : "website";
    const ownerUsername = (loaderData?.file as any)?.owner?.username;

    const thumbnail = getThumbnailUrl(file, { queryString: "?quality=70&is_metadata=true" });
    const thumbnailUrl = `${BASE_URL}${thumbnail}`;

    const thumbPreviewPaths = isVideo ? getThumbnailPreviewApiPaths(file) : null;
    const thumbPreviewPrefetch: import("react-router").MetaDescriptor[] = thumbPreviewPaths
      ? [
          {
            rel: "prefetch",
            href: `${BASE_URL}/api/load/image/${thumbPreviewPaths.json}`,
            crossOrigin: "anonymous",
          },
          {
            rel: "prefetch",
            href: `${BASE_URL}/api/load/image/${thumbPreviewPaths.jpg}`,
            as: "image",
            crossOrigin: "anonymous",
          },
        ]
      : [];

    const extra: import("react-router").MetaDescriptor[] = [
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:secure_url", content: thumbnailUrl },
      { property: "og:image:width", content: "400" },
      { property: "og:image:height", content: "400" },
      ...(ownerUsername ? [{ property: "article:author", content: ownerUsername }] : []),
      ...(file?.created_at
        ? [{ property: "article:published_time", content: new Date(file.created_at).toISOString() }]
        : []),
      // Was the HLS manifest, which needs a token and no crawler can play.
      ...videoPreviewMeta(file as never, thumbnailUrl),
      ...(() => {
        const ld = buildVideoObject({
          file: file as never,
          name: displayTitle,
          description: displayDescription,
          pageUrl: `${BASE_URL}/reel/${encodeURIComponent(String(file.unique_id ?? loaderData.uniqueId ?? ""))}`,
          thumbnailUrl,
          uploadDate: file?.created_at ? new Date(file.created_at).toISOString() : null,
          authorName: ownerUsername ?? null,
        });
        return ld ? [{ "script:ld+json": ld }] : [];
      })(),
      ...(isVideo && !videoPreviewMeta(file as never, thumbnailUrl).length
        ? [{ property: "og:video:type", content: file.file_type || "video/mp4" }]
        : []),
      ...(videoPreviewMeta(file as never, thumbnailUrl).length
        ? []
        : [{ name: "twitter:card", content: isVideo ? "player" : "summary_large_image" }]),
      ...(ownerUsername ? [{ name: "twitter:creator", content: `@${ownerUsername}` }] : []),
      { rel: "preconnect", href: thumbnailUrl, as: "image" },
      { rel: "dns-prefetch", href: BASE_URL },
      ...thumbPreviewPrefetch,
    ];

    return buildPageMeta({
      title: `${displayTitle} | Memories`,
      description: `${displayDescription} | Memories`,
      canonicalPath: `/reel/${encodeURIComponent(String(file.unique_id ?? loaderData.uniqueId ?? ""))}`,
      ogImage: thumbnailUrl,
      ogImageAlt: displayTitle,
      keywords: [file.file_type, isVideo ? "video" : isImage ? "image" : "media", "memories", "reel"].filter(Boolean).join(", "),
      author: ownerUsername,
      ogType,
      extra,
    });
  } catch {
    return buildPageMeta({
      title: "Error | Memories",
      description: "Error loading reel",
      noindex: true,
    });
  }
};

const index = () => {
  const loaderData = useLoaderData<typeof loader>();
  const { file } = loaderData;

  if (!file) {
    const accessDenied = loaderData?.accessDenied === true;
    return (
      <WatchModalShell variant="sheet">
      <div className="flex items-center justify-center min-h-[70vh] py-20 px-4">
        <div className="text-center max-w-xs space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden>
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
              <line x1="7" y1="2" x2="7" y2="22" />
              <line x1="17" y1="2" x2="17" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="2" y1="7" x2="7" y2="7" />
              <line x1="2" y1="17" x2="7" y2="17" />
              <line x1="17" y1="17" x2="22" y2="17" />
              <line x1="17" y1="7" x2="22" y2="7" />
            </svg>
          </div>

          <div className="err-enter space-y-1.5">
            <h1 className="text-lg font-semibold text-foreground">
              {accessDenied ? "Access denied" : "Reel not found"}
            </h1>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {accessDenied
                ? "You do not have permission to view this reel."
                : "This clip may have been taken down or the link is broken."}
            </p>
          </div>

          <div className="err-enter-d1 flex items-center justify-center gap-3">
            <Button asChild size="default" className="rounded-full px-6">
              <Link to="/">Go home</Link>
            </Button>
            <Button asChild variant="outline" size="default" className="rounded-full px-6">
              <Link to="/reel">Browse reels</Link>
            </Button>
          </div>
        </div>
      </div>
      </WatchModalShell>
    );
  }

  const initialUserActions = loaderData.initialUserActions ?? {
    likedFileIds: [] as string[],
    dislikedFileIds: [] as string[],
  };

  return (
    <WatchModalShell variant="sheet">
      <Reel
        initialItems={[file as FileType]}
        initialUserActions={initialUserActions}
        profileReelContext={loaderData.profileReelContext ?? null}
      />
    </WatchModalShell>
  );
};

export default index;
