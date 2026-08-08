/**
 * Meta/SEO tags for the watch page. Body lives here; index.tsx keeps the typed
 * `meta` export so the MetaFunction<ReturnType<typeof loader>> generic does not
 * have to import back into this module.
 */

import { BASE_URL } from "~/lib/URLS";
import { buildPageMeta } from "~/lib/seo";
import { buildVideoObject, videoPreviewMeta } from "~/lib/seo/videoPreview";
import { fileWatchPath } from "~/lib/types";
import { ParseFilename, getThumbnailUrl, getThumbnailPreviewApiPaths } from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";

export function buildDynamicMeta(data: any) {
  try {
    if (!data || !data?.file) {
      const title = data?.accessDenied ? "Access Denied | Memories" : "Not Found | Memories";
      const description = data?.accessDenied
        ? "You do not have permission to view this content."
        : "File not found";
      return buildPageMeta({
        title,
        description,
        canonicalPath: data?.id ? `/${data.id}` : undefined,
        noindex: true,
      });
    }

    const file = data.file;
    const isVideo =
      file?.file_type?.includes("video") ||
      file?.file_type === "application/vnd.apple.mpegurl" ||
      file?.endpoint?.includes(".m3u8");
    const isImage = file?.file_type?.startsWith("image/");
    const displayTitle =
      file?.file_title && file.file_title.trim() !== "" ? file.file_title : ParseFilename(file?.filename || "");
    const likesCount = Number(file?.up_count) || 0;
    const commentsCount = data?.commentsCount || 0;
    const viewsCount = Number(file?.views ?? file?.view_count ?? 0);
    const statsParts: string[] = [];
    if (viewsCount > 0) statsParts.push(`${formatNumber(viewsCount)} views`);
    if (likesCount > 0) statsParts.push(`${likesCount} ${likesCount === 1 ? "like" : "likes"}`);
    if (commentsCount > 0) statsParts.push(`${commentsCount} ${commentsCount === 1 ? "comment" : "comments"}`);
    const statsText = statsParts.length > 0 ? statsParts.join(" · ") : "";
    const baseDescription =
      file?.file_description && file.file_description.trim() !== ""
        ? file.file_description.trim()
        : displayTitle;
    const intentPrefix = isVideo ? "Watch " : isImage ? "View " : "";
    const displayDescription = statsText
      ? `${intentPrefix}${baseDescription} on Memories. ${statsText}`
      : `${intentPrefix}${baseDescription} on Memories.`;
    const metaDescription = displayDescription.slice(0, 155).trim();
    const metaTitle =
      displayTitle.length > 48
        ? `${displayTitle.slice(0, 47).trim()}… | Memories`
        : `${displayTitle} | Memories`;

    const thumbnail = file ? getThumbnailUrl(file, { queryString: '?quality=70&is_metadata=true' }) : '';

    const ogType = isImage ? "image" : "website";
    const thumbnailUrl = `${BASE_URL}${thumbnail}`;

    const thumbPreviewPaths = isVideo && file ? getThumbnailPreviewApiPaths(file) : null;
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
      ...(data?.owner ? [{ property: "article:author", content: data.owner.username }] : []),
      ...(file?.created_at
        ? [{ property: "article:published_time", content: new Date(file.created_at).toISOString() }]
        : []),
      ...(videoPreviewMeta(file as never, thumbnailUrl).length
        ? []
        : [{ name: "twitter:card", content: "summary_large_image" }]),
      ...(data?.owner ? [{ name: "twitter:creator", content: `@${data.owner.username}` }] : []),
      // Public, non-adult videos advertise the preview mp4 so crawlers and
      // social cards have a real file to play.
      ...videoPreviewMeta(file as never, thumbnailUrl),
      { rel: "preconnect", href: thumbnailUrl, as: "image" },
      { rel: "dns-prefetch", href: BASE_URL },
      ...thumbPreviewPrefetch,
    ];

    const categoriesList: string[] = Array.isArray(file?.categories)
      ? (file.categories as unknown[]).filter((c: unknown): c is string => typeof c === "string")
      : [];
    const tagsList: string[] = Array.isArray(file?.tags)
      ? (file.tags as unknown[]).filter((t: unknown): t is string => typeof t === "string")
      : [];
    const keywords = [...categoriesList, ...tagsList, "memories", "share"].filter(Boolean).join(", ");

    return buildPageMeta({
      title: metaTitle,
      description: metaDescription,
      canonicalPath: `/${data?.id}`,
      ogImage: thumbnailUrl,
      ogImageAlt: displayTitle,
      keywords: keywords || [isVideo ? "video" : isImage ? "image" : "media", "memories", "share"].join(", "),
      author: data?.owner?.username,
      ogType,
      extra,
    });
  } catch {
    return buildPageMeta({
      title: "Error | Memories",
      description: "Error loading file",
      noindex: true,
    });
  }
};

