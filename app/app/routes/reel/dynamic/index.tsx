import {
  data,
  Link,
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
} from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";
import { stripGithubRepoForClient } from "~/lib/githubStorage";
import { ownerService } from "~/lib/Services/OwnerService";
import { buildPageMeta } from "~/lib/seo";
import { isAuthenticated } from "~/lib/Security/Password";

function fileIdKey(id: unknown): string {
  return String(id ?? "").toLowerCase();
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const routeUniqueId = params.uniqueId ?? "";
  try {
    if (!db) {
      throw new Error("Database not initialized");
    }

    const { data: rawFile, error } = await db
      .from("files")
      .select("*")
      .eq("unique_id", routeUniqueId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching reel file:", error);
      throw new Error("Failed to fetch reel file");
    }

    const file = rawFile
      ? (stripGithubRepoForClient(rawFile as Record<string, unknown>) as typeof rawFile)
      : null;

    if (!file) {
      return data(
        {
          file: null,
          uniqueId: routeUniqueId,
          accessDenied: false as const,
          reason: undefined,
          initialUserActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
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
        },
        { status: 403 },
      );
    }

    // Enrich file with owner information (matching feed items shape)
    const enrichedFiles = await ownerService.enrichFilesWithOwners([file]);
    let fileWithOwner = (enrichedFiles && enrichedFiles[0]) || file;

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

    return data(
      {
        file: fileWithOwner,
        uniqueId: routeUniqueId,
        accessDenied: false as const,
        reason: undefined,
        initialUserActions,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in reel dynamic loader:", error);
    return data(
      {
        file: null,
        uniqueId: routeUniqueId,
        accessDenied: false as const,
        reason: undefined,
        initialUserActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
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

    const thumbnail = getThumbnailUrl(file, { queryString: '?quality=50' });

    const isVideo =
      file.file_type?.includes("video") ||
      file.file_type === "application/vnd.apple.mpegurl" ||
      file.endpoint?.includes(".m3u8");
    const isImage = file.file_type?.startsWith("image/");
    const ogType = isVideo ? "video.other" : isImage ? "image" : "website";
    const ownerUsername = (loaderData?.file as any)?.owner?.username;

    const extra: import("react-router").MetaDescriptor[] = [
      { property: "og:image:type", content: "image/jpeg" },
      ...(isVideo
        ? [
            { property: "og:video:type", content: file.file_type || "video/mp4" },
            {
              property: "og:video:url",
              content: `${BASE_URL}${getVideoSrc(file.endpoint ?? "", file.file_type)}`,
            },
          ]
        : []),
      { name: "twitter:card", content: isVideo ? "player" : "summary_large_image" },
    ];

    return buildPageMeta({
      title: `${displayTitle} | Memories`,
      description: `${displayDescription} | Memories`,
      canonicalPath: `/reel/${encodeURIComponent(String(file.unique_id ?? loaderData.uniqueId ?? ""))}`,
      ogImage: thumbnail,
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
    return (
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
            <h1 className="text-lg font-semibold text-foreground">Reel not found</h1>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              This clip may have been taken down or the link is broken.
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
    );
  }

  const initialUserActions = loaderData.initialUserActions ?? {
    likedFileIds: [] as string[],
    dislikedFileIds: [] as string[],
  };

  return (
    <Reel initialItems={[file as FileType]} initialUserActions={initialUserActions} />
  );
};

export default index;
