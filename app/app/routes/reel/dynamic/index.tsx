import {
  data,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import db from "~/lib/Database/supabase";
import Reel from "../components/Reel";
import type { FileType } from "~/lib/types";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import { BASE_URL } from "~/lib/URLS";
import {
  arrangeDateForThumbnail,
  ParseFilename,
  getRandomThumbnail,
  getVideoSrc,
} from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";
import { ownerService } from "~/lib/Services/OwnerService";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    if (!db) {
      throw new Error("Database not initialized");
    }

    const { data: file, error } = await db
      .from("files")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching reel file:", error);
      throw new Error("Failed to fetch reel file");
    }

    if (!file) {
      return data(
        {
          file: null,
          id: params.id,
          accessDenied: false as const,
          reason: undefined,
        },
        { status: 404 },
      );
    }

    const accessControl = await checkFileAccess(request, file);

    if (!accessControl.allowed) {
      return data(
        {
          file: null,
          id: params.id,
          accessDenied: true as const,
          reason: accessControl.reason,
        },
        { status: 403 },
      );
    }

    // Enrich file with owner information (matching feed items shape)
    const enrichedFiles = await ownerService.enrichFilesWithOwners([file]);
    const fileWithOwner = (enrichedFiles && enrichedFiles[0]) || file;

    return data(
      {
        file: fileWithOwner,
        id: params.id,
        accessDenied: false as const,
        reason: undefined,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in reel dynamic loader:", error);
    return data(
      {
        file: null,
        id: params.id,
        accessDenied: false as const,
        reason: undefined,
      },
      { status: 500 },
    );
  }
};

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  try {
    if (!loaderData || !loaderData.file) {
      const title = loaderData?.accessDenied
        ? "Access Denied - Memories"
        : "Reel Not Found - Memories";
      const description = loaderData?.accessDenied
        ? "You do not have permission to view this reel."
        : "Reel not found";

      return [
        {
          title,
          description,
        },
      ];
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
    if (viewsCount > 0) {
      statsParts.push(`${formatNumber(viewsCount)} views`);
    }
    if (likesCount > 0) {
      statsParts.push(
        `${likesCount} ${likesCount === 1 ? "like" : "likes"}`,
      );
    }
    if (sharesCount > 0) {
      statsParts.push(`${formatNumber(sharesCount)} shares`);
    }
    if (commentsCount > 0) {
      statsParts.push(
        `${commentsCount} ${commentsCount === 1 ? "comment" : "comments"}`,
      );
    }

    const statsText = statsParts.join(" • ");

    const displayDescription =
      file.file_description && file.file_description.trim() !== ""
        ? `${file.file_description} | ${statsText}`
        : `${ParseFilename(file.filename || "")} | ${statsText} | ${
            file.file_type
          } | ${file.file_size}`;

    let thumbnail = (() => {
      if (file.file_type?.startsWith("image/") && file.endpoint) {
        return `/api/load/image/${file.endpoint}`;
      }
      const randomThumbnail = getRandomThumbnail(file.thumbnails);
      if (randomThumbnail) {
        return `/api/load/image/${randomThumbnail}`;
      }
      const isHls =
        file.file_type === "application/vnd.apple.mpegurl" ||
        file.endpoint?.includes(".m3u8");
      if (isHls) {
        return `/api/load/image/${arrangeDateForThumbnail(
          file.created_at,
        )}/${file.unique_id}/thumbnail_${ParseFilename(file.filename)}.jpg`;
      }
      return `/api/load/image/${file.endpoint}`;
    })();

    thumbnail = `${thumbnail}?quality=50`;

    const isVideo =
      file.file_type?.includes("video") ||
      file.file_type === "application/vnd.apple.mpegurl" ||
      file.endpoint?.includes(".m3u8");
    const isImage = file.file_type?.startsWith("image/");
    const ogType = isVideo ? "video.other" : isImage ? "image" : "website";
    const twitterCard = isVideo ? "player" : "summary_large_image";

    const pageUrl = `${BASE_URL}/reel/${loaderData.id}`;
    const thumbnailUrl = `${BASE_URL}${thumbnail}`;

    return [
      {
        title: `${displayTitle} - Memories`,
      },
      {
        name: "description",
        content: `${displayDescription} - Memories`,
      },
      {
        name: "keywords",
        content: `${file.file_type || ""}, ${
          isVideo ? "video" : isImage ? "image" : "media"
        }, memories, reel`,
      },
      {
        name: "author",
        content:
          ((loaderData?.file as any)?.owner &&
            (loaderData.file as any).owner.username) ||
          "Memories",
      },
      {
        name: "canonical",
        content: pageUrl,
      },
      {
        name: "robots",
        content: "index, follow",
      },
      { property: "og:type", content: ogType },
      { property: "og:title", content: `${displayTitle} - Memories` },
      {
        property: "og:description",
        content: `${displayDescription} - Memories`,
      },
      { property: "og:image", content: thumbnailUrl },
      { property: "og:image:alt", content: displayTitle },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:url", content: pageUrl },
      { property: "og:site_name", content: "Memories" },
      { property: "og:locale", content: "en_US" },
      ...(isVideo
        ? [
            {
              property: "og:video:type",
              content: file.file_type || "video/mp4",
            },
            {
              property: "og:video:url",
              content: `${BASE_URL}${getVideoSrc(
                file.endpoint ?? "",
                file.file_type,
              )}`,
            },
          ]
        : []),
      { name: "twitter:card", content: twitterCard },
      { name: "twitter:title", content: `${displayTitle} - Memories` },
      {
        name: "twitter:description",
        content: `${displayDescription} - Memories`,
      },
      { name: "twitter:image", content: thumbnailUrl },
      { name: "twitter:image:alt", content: displayTitle },
    ];
  } catch (error) {
    console.error("Error in reel meta:", error);
    return [
      {
        title: "Error - Memories",
        description: "Error loading reel",
      },
    ];
  }
};

const index = () => {
  const { file } = useLoaderData<typeof loader>();
  return (
    <>
      {file ? (
        <Reel initialItems={[file as FileType]} />
      ) : (
        <div>Reel Not Found</div>
      )}
    </>
  );
};

export default index;
