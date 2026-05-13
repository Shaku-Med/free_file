import { data, Link, useLoaderData, useNavigate, useParams, useNavigation, useLocation, useSearchParams, useRevalidator, type MetaFunction } from "react-router";
import db from "~/lib/Database/supabase";
import { WatchPlayBootstrapSync } from "./components/WatchPlayBootstrapSync";
import { useCallback, useEffect, useLayoutEffect, useState, useRef, useMemo } from "react";
import RelatedVideos from "./components/RelatedVideos";
import SeriesEpisodesSection from "./components/SeriesEpisodesSection";
import SeriesSignInGate from "./components/SeriesSignInGate";
import { type FileType, type SeriesEpisodeGroup, fileWatchPath } from "~/lib/types";
import { collectSeriesMemberIds, getSeriesUpNextVideos } from "./fun/mapSeriesRpcRows";
import { BASE_URL } from "~/lib/URLS";
import { buildPageMeta } from "~/lib/seo";
import ImageLoad from "../Home/components/ImageLoad/ImageLoad";
import { ParseFilename, getVideoSrc, getThumbnailUrl, getThumbnailPreviewApiPaths, cn } from "~/lib/utils";
import { motion } from "framer-motion";
import { ChevronDown, MessageCircle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useSidebar } from "~/components/ui/sidebar";
import { useStandalone } from "~/lib/hooks/useStandalone";
import { stripGithubRepoForClient } from "~/lib/githubStorage";
import { checkFileAccess } from "./fun/accessControl";
import AdultContentBadge from "./components/AdultContentBadge";
import Actions from "../Home/components/VideoCard/Actions";
import { isAuthenticated } from "~/lib/Security/Password";
import CommentSection from "./components/Comments/CommentSection";
import { FormattedText } from "~/components/FormattedText";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import SubscribeButton, { formatSubscriberCount } from "~/components/SubscribeButton";
import { commentService } from "~/lib/Services/CommentService";
import DownloadButton from "./components/DownloadButton";
import { formatNumber } from "~/lib/utils/formatNumber";
import { useWatchTracking } from "~/lib/hooks/useWatchTracking";
import { IMAGE_BASE_URL } from "~/lib/URLS";
import ParseFilenameInsert from "~/lib/utils/ShowFileName";
import { usePageCache } from "~/lib/hooks/usePageCache";
import CanvasGradient from "~/components/accessories/CanvasGradient/CanvasGradient";
import Ambience from "~/components/accessories/CanvasGradient/Ambience";
import { useFileContext } from "~/lib/Context/Context";
import { isMobile as isMobileDevice } from "react-device-detect";
import { useMiniPlayerContext, isSingleSegmentWatchPath, getDynamicVideoIdFromPath } from "~/lib/Context/MiniPlayerContext";
import { useMainPlayerSlot } from "~/lib/Context/MainPlayerSlotContext";
import { useWatchHlsSurface } from "~/lib/Context/WatchHlsSurfaceContext";
import { useWatchSurfaceVideoRef } from "~/lib/Context/WatchSurfaceVideoRefContext";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import LiquidAmbientGradient from "./components/LiquidAmbientGradient";
import { computeGuestPreviewSeconds } from "~/lib/guestPreviewLimit";
import { sanitizeFileForPublicViewer } from "~/lib/files/sanitizeFileForViewer";
import { personalizationService } from "~/lib/Services/PersonalizationService";

interface DynamicCachePayload {
  file: any;
  id: string;
  relatedVideos: FileType[];
  userLiked: boolean;
  userDisliked: boolean;
  likeCount: number;
  dislikeCount: number;
  userId: string | null;
  owner: { id: string; username: string; profile_pic: string; verified?: boolean } | null;
  channelStats: { subscriber_count: number; is_subscribed: boolean; notify: boolean } | null;
  commentsCount: number;
  relatedVideosUserActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  seriesEpisodes: SeriesEpisodeGroup[] | null;
  /** Present only when this page is a series main file and episodes were loaded (server-verified). */
  seriesContext: { fileSeriesId: string } | null;
  seriesVideosUserActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  /** Max watch seconds for signed-out preview; null when signed in or not applicable. */
  guestPreviewLimitSeconds: number | null;
}

type FreshForBlend = DynamicCachePayload & { _deferredPending?: boolean };

/** Resolved after shell — interactions, channel row, comment count (loads in parallel). */
export type DynamicDeferredDetails = {
  userLiked: boolean;
  userDisliked: boolean;
  likeCount: number;
  dislikeCount: number;
  owner: { id: string; username: string; profile_pic: string; verified?: boolean } | null;
  channelStats: { subscriber_count: number; is_subscribed: boolean; notify: boolean } | null;
  commentsCount: number;
  relatedVideosUserActions: { likedFileIds: string[]; dislikedFileIds: string[] };
};

async function loadDynamicPageDetails(
  file: Record<string, unknown> & { id?: string; owner_id?: string | null },
  userId: string | null
): Promise<DynamicDeferredDetails> {
  if (!db) {
    return {
      userLiked: false,
      userDisliked: false,
      likeCount: 0,
      dislikeCount: 0,
      owner: null,
      channelStats: null,
      commentsCount: 0,
      relatedVideosUserActions: { likedFileIds: [], dislikedFileIds: [] },
    };
  }

  const interactionsP =
    file.id != null
      ? db
          .rpc("get_file_interactions", {
            p_file_id: file.id,
            p_user_id: userId,
          })
          .then((r: { data: unknown }) => r.data)
      : Promise.resolve(undefined);

  const ownerChannelP =
    file.owner_id != null
      ? Promise.all([
          db
            .from("users")
            .select("id, username, profile_pic, verified")
            .eq("id", file.owner_id)
            .maybeSingle(),
          db.rpc("get_channel_stats", {
            p_user_id: file.owner_id,
            p_viewer_id: userId,
          }),
        ])
      : Promise.resolve(null);

  const commentsP =
    file.id != null
      ? commentService.getCommentsCount(file.id, userId)
      : Promise.resolve({ data: 0 });

  const [interactionsData, ownerChannel, commentsCountResult] = await Promise.all([
    interactionsP,
    ownerChannelP,
    commentsP,
  ]);

  let userLiked = false;
  let userDisliked = false;
  let likeCount = 0;
  let dislikeCount = 0;
  const interactions = Array.isArray(interactionsData)
    ? interactionsData[0]
    : interactionsData;
  if (interactions) {
    likeCount = Number((interactions as { like_count?: unknown }).like_count) || 0;
    dislikeCount = Number((interactions as { dislike_count?: unknown }).dislike_count) || 0;
    userLiked = !!(interactions as { user_has_liked?: unknown }).user_has_liked;
    userDisliked = !!(interactions as { user_has_disliked?: unknown }).user_has_disliked;
  }

  let owner: DynamicDeferredDetails["owner"] = null;
  let channelStats: DynamicDeferredDetails["channelStats"] = null;
  if (ownerChannel) {
    const [ownerResult, statsResult] = ownerChannel;
    if (ownerResult.data) {
      owner = {
        id: ownerResult.data.id,
        username: ownerResult.data.username,
        profile_pic: ownerResult.data.profile_pic,
        verified: ownerResult.data.verified ?? false,
      };
    }
    if (statsResult.data) {
      const stats =
        typeof statsResult.data === "string"
          ? JSON.parse(statsResult.data)
          : statsResult.data;
      channelStats = {
        subscriber_count: Number(stats.subscriber_count) || 0,
        is_subscribed: !!stats.is_subscribed,
        notify: stats.notify !== false,
      };
    }
  }

  const commentsCount = commentsCountResult.data || 0;

  return {
    userLiked,
    userDisliked,
    likeCount,
    dislikeCount,
    owner,
    channelStats,
    commentsCount,
    relatedVideosUserActions: { likedFileIds: [], dislikedFileIds: [] },
  };
}

export const loader = async ({ request, params }: { request: Request, params: { id: string } }) => {
  try {
    if(!db){
      throw new Error('Database not initialized');
    }

    const { data: rawFile, error } = await db
      .from('files')
      .select('*')
      .eq('unique_id', params.id).maybeSingle();

    if (error) {
      console.error('Error fetching file:', error);
      throw new Error('Failed to fetch file');
    }

    const file = rawFile
      ? (() => {
          const stripped = stripGithubRepoForClient(
            rawFile as Record<string, unknown>,
          ) as Record<string, unknown>;
          const { thumbnails: _omitThumbnails, ...rest } = stripped;
          return rest as typeof rawFile;
        })()
      : null;

    if (!file) {
      return data({
        file: null,
        id: params.id,
        relatedVideos: [],
        userLiked: false,
        userDisliked: false,
        likeCount: 0,
        dislikeCount: 0,
        userId: null,
        accessDenied: false as const,
        reason: undefined,
        seriesEpisodes: null,
        seriesContext: null,
        seriesVideosUserActions: { likedFileIds: [], dislikedFileIds: [] },
      }, { status: 404 });
    }

    const accessControl = await checkFileAccess(request, file);

    if (!accessControl.allowed) {
      return data({ 
        file: null, 
        id: params.id, 
        relatedVideos: [],
        userLiked: false,
        userDisliked: false,
        likeCount: 0,
        dislikeCount: 0,
        userId: null,
        accessDenied: true as const,
        reason: accessControl.reason,
        seriesEpisodes: null,
        seriesContext: null,
        seriesVideosUserActions: { likedFileIds: [], dislikedFileIds: [] },
      }, { status: 403 });
    }

    let headers = new Headers();

    const user = await isAuthenticated(request, ['id']);
    const userId = user?.id ?? null;

    /** Related videos load client-side via /api/related-videos (smaller HTML, same security). */
    const relatedVideos: FileType[] = [];

    /** Series episodes load via GET /api/dynamic-series after paint (keeps document HTML small). */
    const seriesEpisodes: SeriesEpisodeGroup[] | null = null;
    const seriesContext: { fileSeriesId: string } | null = null;
    const seriesVideosUserActions = { likedFileIds: [] as string[], dislikedFileIds: [] as string[] };

    const durationSec = Number(file.duration);
    const isVideoFile =
      typeof file.file_type === "string" &&
      (file.file_type.includes("video") ||
        file.file_type === "application/vnd.apple.mpegurl" ||
        (typeof file.endpoint === "string" && file.endpoint.includes(".m3u8")));
    const guestPreviewLimitSeconds =
      !userId && isVideoFile && Number.isFinite(durationSec) && durationSec > 0
        ? computeGuestPreviewSeconds(durationSec)
        : null;

    /**
     * Shell returns immediately so the watch page can paint the player and start HLS
     * while interactions / owner / comment count stream in via `pageDetails`.
     */
    const pageDetails = loadDynamicPageDetails(
      file as Record<string, unknown> & { id?: string; owner_id?: string | null },
      userId
    );

    const fileForClient = sanitizeFileForPublicViewer(
      file as unknown as Record<string, unknown>,
      userId
    ) as typeof file;

    return data(
      {
        file: fileForClient,
        id: params.id,
        relatedVideos,
        userId,
        guestPreviewLimitSeconds,
        seriesEpisodes,
        seriesContext,
        seriesVideosUserActions: {
          likedFileIds: seriesVideosUserActions.likedFileIds,
          dislikedFileIds: seriesVideosUserActions.dislikedFileIds,
        },
        accessDenied: false as const,
        reason: undefined,
        pageDetails,
      },
      {
        status: 200,
        headers: headers as unknown as HeadersInit,
      }
    );
  }
  catch (error) {
    console.error('Error in loader:', error);
    return data(null, { status: 500 });
  }
}

export const meta: MetaFunction<ReturnType<typeof loader>> = ({ data }: { data: any }) => {
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
      { name: "twitter:card", content: "summary_large_image" },
      ...(data?.owner ? [{ name: "twitter:creator", content: `@${data.owner.username}` }] : []),
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

function blendDynamicData(cached: DynamicCachePayload, fresh: FreshForBlend): DynamicCachePayload {
  const freshRelatedById = new Map<string, FileType>();
  for (const v of fresh.relatedVideos) {
    if (v.id) freshRelatedById.set(String(v.id), v);
  }

  const blendedRelated = cached.relatedVideos.map(cv => {
    const fv = cv.id ? freshRelatedById.get(String(cv.id)) : undefined;
    if (fv) {
      freshRelatedById.delete(String(cv.id));
      return { ...cv, like_count: fv.like_count, dislike_count: fv.dislike_count, comment_count: fv.comment_count, view_count: fv.view_count, views: fv.views };
    }
    return cv;
  });

  for (const fv of freshRelatedById.values()) {
    blendedRelated.push(fv);
  }

  const mergedLiked = [...new Set([
    ...(cached.relatedVideosUserActions?.likedFileIds ?? []),
    ...(fresh.relatedVideosUserActions?.likedFileIds ?? []),
  ])];
  const mergedDisliked = [...new Set([
    ...(cached.relatedVideosUserActions?.dislikedFileIds ?? []),
    ...(fresh.relatedVideosUserActions?.dislikedFileIds ?? []),
  ])];

  const engagementPending = fresh._deferredPending === true;

  return {
    file: fresh.file,
    id: fresh.id,
    relatedVideos: blendedRelated,
    userLiked: engagementPending ? cached.userLiked : fresh.userLiked,
    userDisliked: engagementPending ? cached.userDisliked : fresh.userDisliked,
    likeCount: engagementPending ? cached.likeCount : fresh.likeCount,
    dislikeCount: engagementPending ? cached.dislikeCount : fresh.dislikeCount,
    userId: fresh.userId,
    owner: fresh.owner ?? cached.owner,
    channelStats: fresh.channelStats ?? cached.channelStats ?? null,
    commentsCount: engagementPending ? cached.commentsCount : fresh.commentsCount,
    relatedVideosUserActions: { likedFileIds: mergedLiked, dislikedFileIds: mergedDisliked },
    seriesEpisodes: fresh.seriesEpisodes,
    seriesContext: fresh.seriesContext,
    seriesVideosUserActions:
      fresh.seriesVideosUserActions ??
      (cached as Partial<DynamicCachePayload>).seriesVideosUserActions ??
      { likedFileIds: [], dislikedFileIds: [] },
    guestPreviewLimitSeconds: fresh.guestPreviewLimitSeconds ?? null,
  };
}

const index = () => {
  const params = useParams();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentId = params.id;
  const pathname = location.pathname;
  const startTimeParam = searchParams.get('t');
  const startTimeFromParam = startTimeParam ? parseFloat(startTimeParam) : undefined;
  const rawHighlightComment = searchParams.get("comment");
  const highlightCommentId =
    rawHighlightComment &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawHighlightComment)
      ? rawHighlightComment
      : null;
  const { getFromCache, addToCache } = usePageCache();
  const {
    theaterMode,
    setTheaterMode,
    userId,
    getDynamicSeriesPayloadCache,
    setDynamicSeriesPayloadCache,
    getRelatedVideosPayloadCache,
    setRelatedVideosPayloadCache,
  } = useFileContext();
  const hasCachedRef = useRef<string | null>(null);

  const [playingVideos, setPlayingVideos] = useState<Set<number>>(new Set());
  const loaderData = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  /** While a video has no HLS manifest yet, poll so shared links pick up the player when processing finishes. */
  useEffect(() => {
    if (!loaderData || loaderData.accessDenied || !("file" in loaderData) || !loaderData.file) return;
    const f = loaderData.file as FileType;
    const isH =
      f.file_type === "application/vnd.apple.mpegurl" ||
      !!(f.endpoint && String(f.endpoint).includes(".m3u8"));
    const isVid =
      isH || !!(f.file_type && String(f.file_type).includes("video"));
    if (!isVid || isH) return;
    const id = window.setInterval(() => {
      revalidator.revalidate();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [loaderData, revalidator]);

  const [resolvedPageDetails, setResolvedPageDetails] = useState<DynamicDeferredDetails | null>(null);

  useEffect(() => {
    setResolvedPageDetails(null);
    if (!loaderData || loaderData.accessDenied || !("file" in loaderData) || !loaderData.file) {
      return;
    }
    if (!("pageDetails" in loaderData) || !loaderData.pageDetails) {
      return;
    }
    const p = loaderData.pageDetails as Promise<DynamicDeferredDetails>;
    if (typeof p?.then !== "function") return;
    let cancelled = false;
    p.then((v) => {
      if (!cancelled) setResolvedPageDetails(v);
    }).catch(() => {
      if (!cancelled) setResolvedPageDetails(null);
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, loaderData]);

  const normalizedLoaderData = useMemo(() => {
    if (!loaderData || loaderData.accessDenied || !("file" in loaderData) || !loaderData.file) {
      return loaderData;
    }
    if (!("pageDetails" in loaderData)) {
      return loaderData;
    }
    const { pageDetails: _pd, ...rest } = loaderData as typeof loaderData & {
      pageDetails: Promise<DynamicDeferredDetails>;
    };
    if (!resolvedPageDetails) {
      return {
        ...rest,
        _deferredPending: true as const,
        userLiked: false,
        userDisliked: false,
        likeCount: 0,
        dislikeCount: 0,
        owner: null,
        channelStats: null,
        commentsCount: 0,
        relatedVideosUserActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
      } as FreshForBlend;
    }
    return {
      ...rest,
      ...resolvedPageDetails,
      _deferredPending: false as const,
    } as FreshForBlend;
  }, [loaderData, resolvedPageDetails]);

  const cached = getFromCache(pathname);
  const cachedData = cached?.data as DynamicCachePayload | undefined;

  const loaderValid = !!(loaderData && loaderData.file && !loaderData.accessDenied);
  const cacheValid = !!(cachedData?.file && cachedData?.id === currentId);

  const effectiveData = useMemo((): DynamicCachePayload | null => {
    if (cacheValid && loaderValid && cachedData && normalizedLoaderData) {
      const nl = normalizedLoaderData as FreshForBlend;
      const freshPayload: FreshForBlend = {
        file: nl.file,
        id: nl.id ?? currentId ?? '',
        relatedVideos: (nl.relatedVideos ?? []) as FileType[],
        userLiked: nl.userLiked || false,
        userDisliked: nl.userDisliked || false,
        likeCount: Number(nl.likeCount) || 0,
        dislikeCount: Number(nl.dislikeCount) || 0,
        userId: nl.userId as string | null,
        owner: nl.owner as any,
        channelStats: nl.channelStats as any,
        commentsCount: nl.commentsCount as number,
        relatedVideosUserActions: nl.relatedVideosUserActions as any,
        seriesEpisodes: nl.seriesEpisodes as SeriesEpisodeGroup[] | null,
        seriesContext: nl.seriesContext as { fileSeriesId: string } | null,
        seriesVideosUserActions:
          nl.seriesVideosUserActions ?? { likedFileIds: [], dislikedFileIds: [] },
        guestPreviewLimitSeconds: nl.guestPreviewLimitSeconds ?? null,
        _deferredPending: nl._deferredPending,
      };
      return blendDynamicData(cachedData, freshPayload);
    }

    if (cacheValid && cachedData) {
      const c = cachedData as Partial<DynamicCachePayload>;
      return {
        ...cachedData,
        seriesEpisodes: c.seriesEpisodes ?? null,
        seriesContext: c.seriesContext ?? null,
        seriesVideosUserActions: c.seriesVideosUserActions ?? {
          likedFileIds: [],
          dislikedFileIds: [],
        },
        guestPreviewLimitSeconds: c.guestPreviewLimitSeconds ?? null,
      } as DynamicCachePayload;
    }

    if (loaderValid && normalizedLoaderData) {
      const nl = normalizedLoaderData as FreshForBlend;
      return {
        file: nl.file,
        id: nl.id ?? currentId ?? '',
        relatedVideos: (nl.relatedVideos ?? []) as FileType[],
        userLiked: nl.userLiked || false,
        userDisliked: nl.userDisliked || false,
        likeCount: Number(nl.likeCount) || 0,
        dislikeCount: Number(nl.dislikeCount) || 0,
        userId: nl.userId as string | null,
        owner: nl.owner as any,
        channelStats: nl.channelStats as any,
        commentsCount: nl.commentsCount as number,
        relatedVideosUserActions: nl.relatedVideosUserActions as any,
        seriesEpisodes: nl.seriesEpisodes as SeriesEpisodeGroup[] | null,
        seriesContext: nl.seriesContext as { fileSeriesId: string } | null,
        seriesVideosUserActions:
          nl.seriesVideosUserActions ?? { likedFileIds: [], dislikedFileIds: [] },
        guestPreviewLimitSeconds: nl.guestPreviewLimitSeconds ?? null,
      };
    }

    return null;
  }, [loaderValid, cacheValid, normalizedLoaderData, cachedData, currentId]);

  useEffect(() => {
    if (!effectiveData?.file) return;
    const cacheKey = `${pathname}:${effectiveData.id}`;
    if (hasCachedRef.current === cacheKey) return;
    hasCachedRef.current = cacheKey;
    addToCache(pathname, {
      data: effectiveData,
      currentPageNumber: 1,
      nextPageNumber: 1,
      totalPages: 0,
      hasMore: false,
    });
  }, [pathname, effectiveData, addToCache]);

  const file_data = effectiveData?.file;
  const data = effectiveData;

  const [seriesFetch, setSeriesFetch] = useState<{
    episodes: SeriesEpisodeGroup[] | null;
    loadState: "idle" | "loading" | "done" | "error";
    userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  }>({
    episodes: null,
    loadState: "idle",
    userActions: { likedFileIds: [], dislikedFileIds: [] },
  });

  const [relatedBootstrap, setRelatedBootstrap] = useState<{
    videos: FileType[];
    userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  } | null>(null);

  const seriesEpisodesResolved = useMemo(
    () => seriesFetch.episodes ?? data?.seriesEpisodes ?? null,
    [seriesFetch.episodes, data?.seriesEpisodes]
  );

  const mergedSidebarUserActions = useMemo(
    () => ({
      likedFileIds: new Set([
        ...(data?.relatedVideosUserActions?.likedFileIds ?? []),
        ...(relatedBootstrap?.userActions?.likedFileIds ?? []),
        ...(seriesFetch.loadState === "done" ? seriesFetch.userActions.likedFileIds : []),
        ...(data?.seriesVideosUserActions?.likedFileIds ?? []),
      ]),
      dislikedFileIds: new Set([
        ...(data?.relatedVideosUserActions?.dislikedFileIds ?? []),
        ...(relatedBootstrap?.userActions?.dislikedFileIds ?? []),
        ...(seriesFetch.loadState === "done" ? seriesFetch.userActions.dislikedFileIds : []),
        ...(data?.seriesVideosUserActions?.dislikedFileIds ?? []),
      ]),
    }),
    [data?.relatedVideosUserActions, data?.seriesVideosUserActions, seriesFetch, relatedBootstrap]
  );

  useEffect(() => {
    if (!data?.file?.unique_id) return;
    const uid = data.file.unique_id;
    const viewerId = data.userId ?? null;
    if (!viewerId || !data.file.file_series_id || !data.file.owner_id) {
      setSeriesFetch({
        episodes: null,
        loadState: "idle",
        userActions: { likedFileIds: [], dislikedFileIds: [] },
      });
      return;
    }
    const seriesId = data.file.file_series_id;
    const cached = getDynamicSeriesPayloadCache(seriesId);
    if (cached) {
      setSeriesFetch({
        episodes: cached.episodes,
        loadState: "done",
        userActions: cached.userActions,
      });
      return;
    }
    const ac = new AbortController();
    setSeriesFetch({
      episodes: null,
      loadState: "loading",
      userActions: { likedFileIds: [], dislikedFileIds: [] },
    });
    fetch(`/api/dynamic-series?unique_id=${encodeURIComponent(uid)}`, {
      credentials: "include",
      signal: ac.signal,
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          seriesEpisodes?: SeriesEpisodeGroup[] | null;
          seriesVideosUserActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
          error?: string;
        };
        if (ac.signal.aborted) return;
        if (r.status === 403 || r.status === 401) {
          setSeriesFetch({
            episodes: null,
            loadState: "error",
            userActions: { likedFileIds: [], dislikedFileIds: [] },
          });
          return;
        }
        const entry = {
          episodes: Array.isArray(j.seriesEpisodes) ? j.seriesEpisodes : null,
          userActions: j.seriesVideosUserActions ?? { likedFileIds: [], dislikedFileIds: [] },
        };
        setDynamicSeriesPayloadCache(seriesId, entry);
        setSeriesFetch({
          episodes: entry.episodes,
          loadState: "done",
          userActions: entry.userActions,
        });
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setSeriesFetch({
            episodes: null,
            loadState: "error",
            userActions: { likedFileIds: [], dislikedFileIds: [] },
          });
        }
      });
    return () => ac.abort();
  }, [
    currentId,
    data?.file?.unique_id,
    data?.file?.file_series_id,
    data?.file?.owner_id,
    data?.userId,
    getDynamicSeriesPayloadCache,
    setDynamicSeriesPayloadCache,
  ]);

  useEffect(() => {
    if (!data?.file?.id) return;
    const fileId = data.file.id;
    const cached = getRelatedVideosPayloadCache(fileId);
    if (cached) {
      setRelatedBootstrap(cached);
      return;
    }
    const ac = new AbortController();
    setRelatedBootstrap(null);
    const relParams = new URLSearchParams({ fileId });
    const sCats = personalizationService.getSessionCategories();
    if (sCats.length > 0) relParams.set("session_cats", JSON.stringify(sCats));
    fetch(`/api/related-videos?${relParams}`, {
      credentials: "include",
      signal: ac.signal,
    })
      .then(async (r) => {
        const result = await r.json().catch(() => ({}));
        if (ac.signal.aborted) return;
        const vids = Array.isArray(result?.data) ? (result.data as FileType[]) : [];
        const next = {
          videos: vids,
          userActions: {
            likedFileIds: result?.userActions?.likedFileIds ?? [],
            dislikedFileIds: result?.userActions?.dislikedFileIds ?? [],
          },
        };
        setRelatedVideosPayloadCache(fileId, next);
        setRelatedBootstrap(next);
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          const fallback = { videos: [], userActions: { likedFileIds: [], dislikedFileIds: [] } };
          setRelatedVideosPayloadCache(fileId, fallback);
          setRelatedBootstrap(fallback);
        }
      });
    return () => ac.abort();
  }, [currentId, data?.file?.id, getRelatedVideosPayloadCache, setRelatedVideosPayloadCache]);

  /** Remember last episode in this series when the viewer leaves the tab (not on every paint). */
  useEffect(() => {
    if (!data?.file?.file_series_id || !data?.file?.unique_id) return;
    const key = `seriesLastWatch:${data.file.file_series_id}`;
    const uid = data.file.unique_id;
    const persist = () => {
      try {
        localStorage.setItem(key, uid);
      } catch {
        /* ignore */
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVis);
      persist();
    };
  }, [data?.file?.file_series_id, data?.file?.unique_id]);

  const [views, setViews] = useState<number>(Number(file_data?.views || file_data?.view_count || 0));
  const [shares, setShares] = useState<number>(Number(file_data?.shares || file_data?.share_count || 0));
  const [hasIncrementedView, setHasIncrementedView] = useState(false);
  const watchVideoRef = useWatchSurfaceVideoRef();
  const [videoRefReady, setVideoRefReady] = useState(false);
  const {
    activateMiniPlayer,
    miniPlayer: activeMiniPlayer,
    closeMiniPlayer,
    dismissMiniPlayerChrome,
    clearExpandHandoff,
    isExpanding,
    expandPlaybackState,
  } = useMiniPlayerContext();
  const { setSlot, state: mainSlotState } = useMainPlayerSlot();
  const { setSurface } = useWatchHlsSurface();
  const mainPlayerSlotTargetRef = useRef<{ isHLS: boolean; uniqueId: string } | null>(null);
  /**
   * Param-swap remounts the anchor div: the ref fires `null` (old el unmounts), then `newEl`
   * (new el mounts) in the same commit. We defer null-clears one rAF so the same-frame
   * remount cancels it — slot transitions directly old→new with no gap, so the global
   * player keeps the same React tree and `<video>` mounted.
   */
  const pendingSlotClearRef = useRef<number | null>(null);
  const mainPlayerAnchorRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (pendingSlotClearRef.current != null) {
        cancelAnimationFrame(pendingSlotClearRef.current);
        pendingSlotClearRef.current = null;
      }
      if (!el) {
        pendingSlotClearRef.current = requestAnimationFrame(() => {
          pendingSlotClearRef.current = null;
          setSlot(null, null);
        });
        return;
      }
      const t = mainPlayerSlotTargetRef.current;
      if (t?.isHLS) setSlot(t.uniqueId, el);
      else setSlot(null, null);
    },
    [setSlot],
  );

  useEffect(() => {
    if (!file_data) setSlot(null, null);
  }, [file_data, setSlot]);

  useEffect(() => {
    return () => {
      if (pendingSlotClearRef.current != null) {
        cancelAnimationFrame(pendingSlotClearRef.current);
        pendingSlotClearRef.current = null;
      }
      setSlot(null, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run cleanup only on full route unmount
  }, []);

  const activeMiniPlayerRef = useRef(activeMiniPlayer);
  activeMiniPlayerRef.current = activeMiniPlayer;

  useEffect(() => {
    if (!file_data?.unique_id) return;
    const fd = file_data;
    const hls = fd.file_type === 'application/vnd.apple.mpegurl' || !!fd.endpoint?.includes('.m3u8');
    const isVideoFile = hls || !!fd.file_type?.includes('video');
    if (isVideoFile) return;
    if (!activeMiniPlayer) return;
    closeMiniPlayer();
  }, [
    file_data?.unique_id,
    file_data?.file_type,
    file_data?.endpoint,
    activeMiniPlayer,
    closeMiniPlayer,
  ]);

  const expandMatch = expandPlaybackState && expandPlaybackState.fileId === currentId ? expandPlaybackState : null;
  // Only ?t= deep-link should seek on load. Mini→watch uses the same global `<video>`;
  // passing expand snapshot here re-runs `usePlaybackPosition` and seeks backward / stutters.
  const startTime = startTimeFromParam;

  const prevIdRef = useRef<string | undefined>(currentId);
  const viewIncrementSentRef = useRef(false);

  useEffect(() => {
    if (prevIdRef.current && prevIdRef.current !== currentId) {
      setPlayingVideos(new Set());
      setHasIncrementedView(false);
      viewIncrementSentRef.current = false;
      setRetryAttempt(0);
      setImageColors(null);
      setMadeImageUrl(null);
      hasCachedRef.current = null;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevIdRef.current = currentId;
  }, [currentId]);
  
  useEffect(() => {
    if (file_data) {
      const newViews = Number(file_data.views || file_data.view_count || 0);
      const newShares = Number(file_data.shares || file_data.share_count || 0);
      setViews(newViews);
      setShares(newShares);
    }
  }, [file_data?.id, file_data?.views, file_data?.view_count, file_data?.shares, file_data?.share_count]);

  if (loaderData?.accessDenied) {
    const getAccessDeniedMessage = () => {
      switch (loaderData.reason) {
        case 'not_authenticated':
          return {
            title: 'Authentication Required',
            message: 'You must be logged in to view this content.',
            action: '/auth/login',
            actionText: 'Login'
          };
        case 'underage':
          return {
            title: 'Age Restriction',
            message: 'This content is restricted to users 18 years and older.'
          };
        case 'not_owner':
          return {
            title: 'Access Denied',
            message: 'This file is private and can only be viewed by its owner.'
          };
        case 'private_file':
          return {
            title: 'Access Denied',
            message: 'This file is private and can only be viewed by its owner.'
          };
        default:
          return {
            title: 'Access Denied',
            message: 'You do not have permission to view this content.'
          };
      }
    };

    const { title, message, action, actionText } = getAccessDeniedMessage();

    return (
      <div className="flex items-center justify-center min-h-[70vh] py-20 px-4">
        <div className="text-center max-w-xs space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
              <circle cx="12" cy="16" r="1" />
            </svg>
          </div>

          <div className="err-enter space-y-1.5">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            <p className="text-[13px] text-muted-foreground leading-relaxed">{message}</p>
          </div>

          <div className="err-enter-d1 flex items-center justify-center gap-3">
            {action && (
              <Button asChild size="default" className="rounded-full px-6">
                <Link to={action}>{actionText}</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="default" className="rounded-full px-6">
              <Link to="/">Home</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }
  
  if(!file_data || !data) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] py-20 px-4">
        <div className="text-center max-w-xs space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden>
              <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>

          <div className="err-enter space-y-1.5">
            <h1 className="text-lg font-semibold text-foreground">File not found</h1>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              It may have been removed or made private by its owner.
            </p>
          </div>

          <div className="err-enter-d1">
            <Button asChild size="default" className="rounded-full px-6">
              <Link to="/">Go home</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isHLS = file_data?.file_type === 'application/vnd.apple.mpegurl' || file_data?.endpoint?.includes('.m3u8');
  const isVideo = isHLS || file_data?.file_type?.includes('video');
  /** Video upload still processing: playable stream not ready yet (YouTube-style poster + optional owner progress). */
  const showVideoProcessingPlaceholder = Boolean(isVideo && !isHLS);

  mainPlayerSlotTargetRef.current = file_data
    ? { isHLS, uniqueId: file_data.unique_id }
    : null;

  useWatchTracking({
    fileId: file_data?.id || '',
    userId: userId,
    isVideo: isVideo,
    videoElement: watchVideoRef.current,
    source: 'page_view',
  });

  useEffect(() => {
    if (!file_data?.id || !file_data?.unique_id) return;
    const payload = { fileId: file_data.id, uniqueId: file_data.unique_id };
    fetch('/api/views/watch-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    }).catch(() => {});
  }, [currentId, file_data?.id, file_data?.unique_id]);

  const [retryAttempt, setRetryAttempt] = useState<number>(0)
  const [imageColors, setImageColors] = useState<string[] | null>(null)
  const [madeImageUrl, setMadeImageUrl] = useState<string | null>(null)
  const [ambientEnabled, setAmbientEnabled] = useState<boolean>(() => {
    try {
      if (typeof document === 'undefined') return false;
      const cookies = document.cookie ? document.cookie.split('; ') : [];
      for (const cookie of cookies) {
        const [key, value] = cookie.split('=');
        if (key === 'player-ambient-mode') {
          return decodeURIComponent(value) === '1';
        }
      }
      return false;
    } catch {
      return false;
    }
  })

  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [liked, setLiked] = useState(data.userLiked || false)
  const [disliked, setDisliked] = useState(data.userDisliked || false)
  const [likeCount, setLikeCount] = useState(Number(data.likeCount) || 0)
  const [dislikeCount, setDislikeCount] = useState(Number(data.dislikeCount) || 0)
  const { isMobile: isSidebarMobile, state } = useSidebar();
  const [mobileCommentsOpen, setMobileCommentsOpen] = useState(false);
  useEffect(() => {
    setMobileCommentsOpen(false);
  }, [currentId, file_data?.id]);
  const isStandalone = useStandalone();
  

  useEffect(() => {
    if (!file_data || !data) return;
    setLiked(data.userLiked || false);
    setDisliked(data.userDisliked || false);
    setLikeCount(Number(data.likeCount) || 0);
    setDislikeCount(Number(data.dislikeCount) || 0);
  }, [
    currentId,
    file_data?.id,
    data.userLiked,
    data.userDisliked,
    data.likeCount,
    data.dislikeCount,
  ]);

  const handleInteractionUpdate = (updates: { liked: boolean; disliked: boolean; like_count: number; dislike_count: number }) => {
    setLiked(updates.liked);
    setDisliked(updates.disliked);
    setLikeCount(updates.like_count);
    setDislikeCount(updates.dislike_count);
  }

  const commentsCount = data.commentsCount || 0;
  const isOwner = Boolean(userId && file_data?.owner_id && userId === file_data.owner_id);

  const retry = useCallback(() => {
    if(retryAttempt >= 1) return;
    setRetryAttempt(prev => prev + 1);
  }, [retryAttempt])

  const imageLoadCallBack = useCallback((e: { src: string; colors: string[] }) => {
    setMadeImageUrl(e.src)
    setImageColors(e.colors)
  }, [])

  const hlsCallBack = useCallback((e: { src: string; colors: string[] }) => {
    setImageColors(e.colors)
    setMadeImageUrl(e.src)
  }, [])

  // When expanding from mini player, apply the mini player's volume/muted/playbackRate to the main video
  const appliedExpandRef = useRef(false);
  useEffect(() => {
    if (!expandPlaybackState) appliedExpandRef.current = false;
  }, [expandPlaybackState]);

  useEffect(() => {
    if (!expandMatch || appliedExpandRef.current) return;
    const video = watchVideoRef.current;
    if (!video) return;

    const applyExpandState = () => {
      if (appliedExpandRef.current) return;
      appliedExpandRef.current = true;
      video.volume = expandMatch.volume;
      video.muted = expandMatch.muted;
      video.playbackRate = expandMatch.playbackRate;
      if (expandMatch.wasPlaying && video.paused) {
        video.play().catch(() => {});
      }
      clearExpandHandoff();
    };

    if (video.readyState >= 2) {
      applyExpandState();
    } else {
      video.addEventListener('canplay', applyExpandState, { once: true });
      return () => video.removeEventListener('canplay', applyExpandState);
    }
  }, [expandMatch, clearExpandHandoff, activeMiniPlayer]);

  const handleVideoRef = useCallback((ref: HTMLVideoElement | null) => {
    setVideoRefReady(!!ref);
  }, [])

  const handleVideoSelect = useCallback((video: FileType) => {
    navigate(`/${video.unique_id}`);
  }, [navigate])

  const relatedVideos =
    relatedBootstrap && relatedBootstrap.videos.length > 0
      ? relatedBootstrap.videos
      : (data.relatedVideos ?? []);
  const seriesMemberIds = useMemo(
    () => collectSeriesMemberIds(seriesEpisodesResolved),
    [seriesEpisodesResolved]
  );
  const seriesUpNextVideos = useMemo(
    () => getSeriesUpNextVideos(seriesEpisodesResolved, currentId ?? ""),
    [seriesEpisodesResolved, currentId]
  );
  const suggestedVideos = useMemo(
    () =>
      relatedVideos
        .filter(
          (v: FileType) => v.unique_id !== currentId && !seriesMemberIds.has(v.unique_id)
        )
        .slice(0, 10),
    [relatedVideos, currentId, seriesMemberIds]
  );

  const isNavigating = navigation.state === 'loading' && navigation.location?.pathname !== window.location.pathname;

  const requiredViewSeconds = (() => {
    if (isHLS && file_data?.duration != null && Number(file_data.duration) > 0) {
      const d = Number(file_data.duration);
      const half = Math.ceil(d * 0.5);
      return Math.min(30, Math.max(3, half));
    }
    return 30;
  })();

  const runViewIncrement = useCallback((currentTimeSeconds?: number, durationSeconds?: number) => {
    if (!file_data?.id || !file_data?.unique_id || hasIncrementedView || viewIncrementSentRef.current) return;
    viewIncrementSentRef.current = true;
    const payload = {
      fileId: file_data.id,
      uniqueId: file_data.unique_id,
      currentTimeSeconds: typeof currentTimeSeconds === 'number' ? currentTimeSeconds : requiredViewSeconds,
      durationSeconds:
        typeof durationSeconds === 'number'
          ? durationSeconds
          : file_data.duration != null
            ? Number(file_data.duration)
            : undefined,
    };
    fetch('/api/views/increment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then((r) => (r.ok ? r.json() : null))
      .then((result) => {
        if (result?.success && result.counted !== false) {
          setViews((v) => result.views ?? result.view_count ?? v + 1);
          setHasIncrementedView(true);
        }
      })
      .catch(() => {});
  }, [file_data?.id, file_data?.unique_id, file_data?.duration, hasIncrementedView, requiredViewSeconds]);

  const onVideoTimeForView = useCallback(() => {
    if (hasIncrementedView || viewIncrementSentRef.current) return;
    const v = watchVideoRef.current;
    if (!v || !Number.isFinite(v.currentTime)) return;
    if (v.currentTime >= requiredViewSeconds) {
      runViewIncrement(v.currentTime, Number.isFinite(v.duration) ? v.duration : undefined);
    }
  }, [hasIncrementedView, requiredViewSeconds, runViewIncrement, watchVideoRef]);

  const watchHlsPayload = useMemo(() => {
    if (!isHLS || !file_data) return null;
    return {
      theaterMode,
      props: {
        videoRef: watchVideoRef as React.RefObject<HTMLVideoElement>,
        src: getVideoSrc(file_data.endpoint ?? "", file_data.file_type),
        className: "h-full w-full",
        onPlay: () => {
          setPlayingVideos((prev) => new Set(prev).add(1));
          onVideoTimeForView();
        },
        onPause: () =>
          setPlayingVideos((prev) => {
            const next = new Set(prev);
            next.delete(1);
            return next;
          }),
        onEnded: () => onVideoTimeForView(),
        autoPlay: true,
        muted: false,
        playsInline: true,
        imageID: file_data.unique_id,
        file: { ...file_data, owner: data?.owner },
        onVideoRef: handleVideoRef,
        callBack: hlsCallBack,
        endScreenUserActions: mergedSidebarUserActions,
        currentUserId: userId || undefined,
        onVideoSelect: handleVideoSelect,
        onAmbientModeChange: setAmbientEnabled,
        startTime,
        authPlaybackFeatures: Boolean(userId),
        guestWatchLimitSeconds: data?.guestPreviewLimitSeconds ?? null,
        seriesEpisodeGroups: seriesEpisodesResolved,
      },
    };
  }, [
    isHLS,
    file_data,
    data?.owner,
    theaterMode,
    watchVideoRef,
    onVideoTimeForView,
    handleVideoRef,
    hlsCallBack,
    mergedSidebarUserActions,
    userId,
    handleVideoSelect,
    setAmbientEnabled,
    startTime,
    data?.guestPreviewLimitSeconds,
    seriesEpisodesResolved,
  ]);

  useEffect(() => {
    const v = watchVideoRef.current;
    if (!v) return;
    v.addEventListener('timeupdate', onVideoTimeForView);
    return () => v.removeEventListener('timeupdate', onVideoTimeForView);
  }, [watchVideoRef, onVideoTimeForView]);

  /**
   * Don't clear surface on payload swap — that causes a transient `null` between cleanup
   * and the new effect run, which unmounts the global player and forces a fresh HLS init
   * on every watch→watch param swap. The dedicated unmount effect below handles real exit.
   */
  useLayoutEffect(() => {
    setSurface(watchHlsPayload ?? null);
  }, [watchHlsPayload, setSurface]);

  useEffect(() => {
    return () => {
      const path = typeof window !== "undefined" ? window.location.pathname : "";
      // Keep current surface alive during watch->watch handoff so playback doesn't drop to null.
      if (isSingleSegmentWatchPath(path)) return;
      setSurface(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run cleanup only on full route unmount
  }, []);

  useEffect(() => {
    if (navigation.state !== "idle") return;
    if (!watchHlsPayload || !activeMiniPlayer) return;
    if (activeMiniPlayer.file.unique_id !== currentId) return;
    if (!mainSlotState.anchorEl || mainSlotState.uniqueId !== currentId) return;

    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        dismissMiniPlayerChrome();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [
    navigation.state,
    watchHlsPayload,
    activeMiniPlayer,
    currentId,
    mainSlotState.anchorEl,
    mainSlotState.uniqueId,
    dismissMiniPlayerChrome,
  ]);

  // View increment is now time-based (timeupdate), no timeout cleanup needed.

  const fileDataRef = useRef(file_data);
  fileDataRef.current = file_data;
  const isHLSRef = useRef(false);

  useEffect(() => {
    const fd = fileDataRef.current;
    isHLSRef.current = fd?.file_type === 'application/vnd.apple.mpegurl' || !!fd?.endpoint?.includes('.m3u8');
  });

  /* Full unmount of the watch index only (not param swaps on the same route). */
  useEffect(() => {
    return () => {
      if (activeMiniPlayerRef.current) return;
      const path = typeof window !== "undefined" ? window.location.pathname : "";
      const destId = getDynamicVideoIdFromPath(path);
      // Race-defense: URL still says we're on this watch page (unmount without nav) — leave the player alone.
      if (destId && fileDataRef.current && destId === fileDataRef.current.unique_id) return;
      // Different watch ID is taking over — let it own the handoff.
      if (isSingleSegmentWatchPath(path)) return;
      // Reel owns the global player — no mini handoff, just tear down.
      if (path === "/reel" || path.startsWith("/reel/")) return;
      const video = watchVideoRef.current;
      const fd = fileDataRef.current;
      if (!video || !fd || !isHLSRef.current) return;
      // Paused/ended → fall through to natural unmount; HLS is destroyed in useHLS cleanup.
      if (video.paused || video.ended) return;
      activateMiniPlayer({
        src: getVideoSrc(fd.endpoint ?? "", fd.file_type),
        file: fd,
        imageID: fd.unique_id,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only on true unmount of this screen
  }, [activateMiniPlayer]);

  useEffect(() => {
    if (isHLS || hasIncrementedView || !file_data?.id) return;
    const t = setTimeout(runViewIncrement, requiredViewSeconds * 1000);
    return () => clearTimeout(t);
  }, [isHLS, file_data?.id, hasIncrementedView, runViewIncrement, requiredViewSeconds]);

  const videoBlock = (
    <motion.div layoutId={`video_id_${file_data.unique_id}`}
    className={`
      relative z-10 w-full overflow-hidden
      ${isStandalone ? "pt-8" : ""}
      ${theaterMode ? "bg-black" : "rounded-lg"}
    `} 
    key={`video-wrapper-${file_data.unique_id}-${currentId}`}
    >
      {file_data?.is_adult && (
        <AdultContentBadge isPlaying={playingVideos.has(1)} className="top-3 left-3" />
      )}
      {
        !isHLS && (
          <CanvasGradient className={`${isStandalone ? "mt-8" : ""}`} colors={imageColors || []} />
        )
      }
      <div
        ref={mainPlayerAnchorRef}
        className={cn(
          "relative w-full",
          theaterMode
            ? "max-h-[calc(100vh-64px)] aspect-video mx-auto"
            : "aspect-video",
          isHLS && `player_inner_${file_data.unique_id}`,
        )}
      >
        {isHLS ? null : showVideoProcessingPlaceholder ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
            <img
              src={getThumbnailUrl(file_data, {
                baseUrl: BASE_URL,
                queryString: "?quality=75&is_metadata=true",
              })}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0";
              }}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 space-y-2 p-4">
              {isOwner &&
              typeof file_data.processing_progress === "number" &&
              Number.isFinite(file_data.processing_progress) ? (
                <>
                  <div className="flex items-center justify-between text-xs font-medium tabular-nums text-white/95">
                    <span>Processing</span>
                    <span>
                      {Math.round(
                        Math.min(100, Math.max(0, Number(file_data.processing_progress)))
                      )}
                      %
                    </span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-white/20"
                    role="progressbar"
                    aria-valuenow={Math.round(
                      Math.min(100, Math.max(0, Number(file_data.processing_progress)))
                    )}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                      style={{
                        width: `${Math.min(100, Math.max(0, Number(file_data.processing_progress)))}%`,
                      }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm font-medium leading-snug text-white drop-shadow-sm">
                  This video is still processing. Check back shortly.
                </p>
              )}
            </div>
          </div>
        ) : (
          <motion.div
            transition={{ duration: 0.1 }}
            layoutId={`image_id_${file_data.unique_id}`}
            className="relative aspect-video w-full cursor-zoom-in"
          >
            <ImageLoad
              link={`/api/load/image/${file_data.endpoint}`}
              retry={retry}
              className="w-full h-full object-contain"
              imageID={file_data.unique_id}
              index={0}
              hasAdultTag={Boolean(file_data.is_adult)}
              callBack={imageLoadCallBack}
              key={file_data.unique_id}
              shouldShowPreview={true}
            />
          </motion.div>
        )}
      </div>
    </motion.div>
  );

  const description = file_data.file_description?.trim() ?? "";
  const descriptionPreviewLength = 120;
  const hasLongDescription = description.length > descriptionPreviewLength;
  const descriptionToShow = descriptionExpanded || !hasLongDescription ? description : description.slice(0, descriptionPreviewLength);

  const categoriesList: string[] = Array.isArray(file_data.categories)
    ? (file_data.categories as unknown[]).filter((c: unknown): c is string => typeof c === "string")
    : [];
  const tagsList: string[] = Array.isArray(file_data.tags)
    ? (file_data.tags as unknown[]).filter((t: unknown): t is string => typeof t === "string")
    : [];

  const jsonLdThumbnail = file_data
    ? getThumbnailUrl(file_data, { baseUrl: BASE_URL, queryString: '?quality=70&is_metadata=true' })
    : '';
  const pageUrlForLd = `${BASE_URL}/${data.id ?? currentId}`;
  const ldTitle = (file_data?.file_title?.trim() || ParseFilename(file_data?.filename || "")) || "Media";
  const ldDescription = (file_data?.file_description?.trim() || ldTitle).slice(0, 200);
  const ownerName = data.owner ? data.owner.username : undefined;
  const jsonLd = isVideo
    ? {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        name: ldTitle,
        description: ldDescription,
        thumbnailUrl: jsonLdThumbnail,
        uploadDate: file_data?.created_at ? new Date(file_data.created_at).toISOString() : undefined,
        url: pageUrlForLd,
        ...(ownerName ? { author: { "@type": "Person", name: ownerName } } : {}),
      }
    : {
        "@context": "https://schema.org",
        "@type": "ImageObject",
        name: ldTitle,
        description: ldDescription,
        contentUrl: file_data?.endpoint ? `${BASE_URL}/api/load/image/${file_data.endpoint}` : undefined,
        thumbnail: jsonLdThumbnail,
        url: pageUrlForLd,
        ...(ownerName ? { author: { "@type": "Person", name: ownerName } } : {}),
      };

  const contentColumn = (
    <div className="relative space-y-4 max-lg:overflow-visible max-lg:rounded-none max-lg:px-2 max-lg:py-0 lg:overflow-hidden lg:rounded-lg lg:p-4">
      <h1 className="text-xl font-bold text-foreground leading-tight select-text">
        <ParseFilenameInsert filename={file_data.file_title || file_data.filename}/>
      </h1>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        {data.owner && (
          <div className="flex items-center justify-between gap-3 lg:flex-1 lg:min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <OwnerProfile owner={data.owner} size="md" showUsername={false} />
              <div className="min-w-0">
                <Link to={`/profile/${data.owner.username}`} className="font-semibold text-foreground hover:text-primary transition-colors truncate block">
                  {data.owner.username}
                </Link>
                {data.channelStats && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatSubscriberCount(data.channelStats.subscriber_count)} subscribers
                  </p>
                )}
              </div>
            </div>
            {data.channelStats && !isOwner && (
              <SubscribeButton
                channelId={data.owner.id}
                currentUserId={userId}
                initialSubscribed={data.channelStats.is_subscribed}
                initialNotify={data.channelStats.notify}
                initialCount={data.channelStats.subscriber_count}
                isOwner={isOwner}
              />
            )}
          </div>
        )}

        <Actions
        key={`actions-${file_data.id}-${currentId}`}
        fileId={String(file_data.id)}
        uniqueId={file_data.unique_id}
        sharePagePath={fileWatchPath(file_data)}
        likeCount={likeCount}
        dislikeCount={dislikeCount}
        commentCount={commentsCount}
        liked={liked}
        disliked={disliked}
        isOwner={isOwner}
        onEdit={undefined}
        onUpdate={userId ? handleInteractionUpdate : undefined}
        getShareTimestamp={isHLS ? () => watchVideoRef.current?.currentTime ?? 0 : undefined}
        onShareSuccess={(serverCount) => {
          if (typeof serverCount === "number" && !Number.isNaN(serverCount)) setShares(serverCount);
          else setShares((s) => s + 1);
        }}
        currentTime={isHLS ? (watchVideoRef.current?.currentTime ?? 0) : undefined}
        currentUserId={userId}
        isAdult={file_data.is_adult}
        fileOwnerId={file_data.owner_id || undefined}
        commentsEnabled={file_data.comments_enabled !== false}
        highlightCommentId={highlightCommentId}
        commentsOpen={isMobileDevice ? mobileCommentsOpen : undefined}
        onCommentsOpenChange={isMobileDevice ? setMobileCommentsOpen : undefined}
      />
      </div>

      {/* YouTube-style description card: stats inline at top, body below, "...more" toggle. */}
      <div className="rounded-xl bg-muted/40 px-3 py-2.5 max-lg:rounded-lg">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
          <span className="font-semibold tabular-nums">{formatNumber(views)} views</span>
          {file_data.created_at && (
            <span className="font-semibold">{formatTimeAgo(file_data.created_at)}</span>
          )}
        </div>
        {(description || hasLongDescription) && (
          <div className="mt-1.5">
            <div className="text-sm text-foreground break-words">
              <FormattedText text={descriptionToShow} />
              {hasLongDescription && !descriptionExpanded && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => setDescriptionExpanded(true)}
                    className="font-semibold text-foreground hover:underline"
                  >
                    ...more
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {(categoriesList.length > 0 || tagsList.length > 0) && (
          <div className="pb-3 pt-2">
            <details className="group rounded-lg border border-border/60 bg-muted/10 overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/25 transition-colors [&::-webkit-details-marker]:hidden">
                <span>Categories & tags</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {categoriesList.length + tagsList.length}{" "}
                    {categoriesList.length + tagsList.length === 1 ? "item" : "items"}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                </span>
              </summary>
              <div className="border-t border-border/50 px-3 py-3 space-y-4 bg-background/40">
                {categoriesList.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Categories</p>
                    <ul className="space-y-1.5 border-l-2 border-primary/25 pl-3">
                      {categoriesList.map((c) => (
                        <li key={c}>
                          <Link
                            to={`/tag/${encodeURIComponent(c)}`}
                            className="text-sm text-primary hover:underline decoration-primary/40 underline-offset-2"
                          >
                            {c}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {tagsList.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Tags</p>
                    <ul className="space-y-1.5 border-l-2 border-border pl-3">
                      {tagsList.map((t) => (
                        <li key={t}>
                          <Link
                            to={`/tag/${encodeURIComponent(t)}`}
                            className="text-sm text-foreground hover:text-primary hover:underline underline-offset-2"
                          >
                            {t}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </div>
        )}
      </div>

      {isMobileDevice ? (
        <div id="comments" className="scroll-mt-20">
          {file_data.comments_enabled === false ? (
            <p className="rounded-md border border-border/70 bg-muted/15 px-2.5 py-2 text-xs text-muted-foreground">
              Comments are turned off for this upload.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setMobileCommentsOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-border/80 bg-muted/25 px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/40 active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              aria-expanded={mobileCommentsOpen}
              aria-controls="watch-comments-drawer"
            >
              <MessageCircle className="size-4 shrink-0 opacity-80" aria-hidden />
              <span className="min-w-0 flex-1 text-muted-foreground">Add a comment</span>
            </button>
          )}
        </div>
      ) : (
        <div id="comments" className="scroll-mt-24">
          <CommentSection
            key={`comments-${file_data.id}-${currentId}-${highlightCommentId ?? ""}`}
            fileId={file_data.id}
            currentUserId={userId || undefined}
            fileOwnerId={file_data.owner_id || undefined}
            commentsEnabled={file_data.comments_enabled !== false}
            highlightCommentId={highlightCommentId}
          />
        </div>
      )}
    </div>
  );

  /** Below video, above content column on small screens only; lg+ uses sidebar (hidden here). */
  const showSeriesChrome =
    !!file_data.file_series_id &&
    (!userId ||
      seriesFetch.loadState === "loading" ||
      (seriesEpisodesResolved != null && seriesEpisodesResolved.length > 0));

  const seriesAboveContentMobile = showSeriesChrome ? (
    <div className="z-[100000] mb-3 min-w-0 lg:hidden">
      {!userId ? (
        <SeriesSignInGate />
      ) : seriesFetch.loadState === "loading" ? (
        <div
          className="h-28 animate-pulse rounded-lg border border-border/60 bg-muted/25"
          aria-busy
          aria-label="Loading series"
        />
      ) : seriesEpisodesResolved && seriesEpisodesResolved.length > 0 ? (
        <SeriesEpisodesSection
          episodes={seriesEpisodesResolved}
          currentVideoUniqueId={file_data.unique_id}
          fileSeriesId={file_data.file_series_id ?? null}
          currentUserId={userId || undefined}
          userActions={mergedSidebarUserActions}
        />
      ) : null}
    </div>
  ) : null;

  const relatedColumn = (
    <aside className="min-w-0 lg:col-span-1">
      <div className="space-y-4 lg:sticky lg:top-6">
        {showSeriesChrome && (
          <div className="mb-3 hidden lg:block">
            {!userId ? (
              <SeriesSignInGate />
            ) : seriesFetch.loadState === "loading" ? (
              <div
                className="h-28 animate-pulse rounded-lg border border-border/60 bg-muted/25"
                aria-busy
                aria-label="Loading series"
              />
            ) : seriesEpisodesResolved && seriesEpisodesResolved.length > 0 ? (
              <SeriesEpisodesSection
                episodes={seriesEpisodesResolved}
                currentVideoUniqueId={file_data.unique_id}
                fileSeriesId={file_data.file_series_id ?? null}
                currentUserId={userId || undefined}
                userActions={mergedSidebarUserActions}
              />
            ) : null}
          </div>
        )}
        <div className="min-w-0 rounded-lg border border-border/40 bg-card/30 p-2 sm:p-3 lg:border-0 lg:bg-transparent lg:p-0">
          <RelatedVideos
            key={`related-${file_data.unique_id}-${relatedVideos.length}-${relatedBootstrap?.videos?.[0]?.id ?? ""}`}
            videos={relatedVideos}
            currentVideoId={file_data.unique_id}
            currentVideoDbId={file_data.id}
            ownerId={file_data.owner_id}
            currentUserId={userId || undefined}
            currentFileType={file_data.file_type}
            userActions={mergedSidebarUserActions}
          />
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <WatchPlayBootstrapSync
        currentUniqueId={file_data.unique_id}
        seriesUpNextVideos={seriesUpNextVideos}
        suggestedVideos={suggestedVideos}
        viewerCanCustomizeQueue={Boolean(userId)}
      />
    <div className="relative min-h-screen reel_p" key={`dynamic-${currentId}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="relative z-10 mx-auto max-w-full">
        {/* 
          never remove this comment
          This is the original grid layout for the watch page I may change it later but for now keep it here.
          <div className={!theaterMode ? "grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3 lg:gap-6 xl:gap-8" : ""}>
          <div className={!theaterMode ? "min-w-0 space-y-3 sm:space-y-4 lg:col-span-2" : ""}>
        */}
        <div className={!theaterMode ? "watch-grid" : ""}>
          <div className={!theaterMode ? "min-w-0 space-y-3 sm:space-y-4 lg:col-span-2 xl:col-span-1" : ""}>
            <div
              className={cn(
                "relative w-full overflow-visible",
                isMobileDevice &&
                  !theaterMode &&
                  "sticky top-[calc(env(safe-area-inset-top,0px)+4rem)] z-[99999990] self-start bg-background",
              )}
            >
              {videoBlock}
              {ambientEnabled && (
                <div
                  className="ambience-wrap pointer-events-none absolute -z-10"
                  aria-hidden
                  style={{
                    inset: "-60% -40%",
                    overflow: "visible",
                  }}
                >
                  {isSidebarMobile && (
                    <div className="mobile_blur_overlay absolute inset-x-0 bottom-0 h-full z-[10] bg-gradient-to-t from-background/95 via-background/60 to-transparent" />
                  )}
                  <div
                    className="absolute inset-0 opacity-80"
                    style={{
                      WebkitMaskImage:
                        "radial-gradient(ellipse 60% 55% at 50% 50%, black 10%, rgba(0,0,0,0.5) 35%, rgba(0,0,0,0.15) 55%, transparent 70%)",
                      maskImage:
                        "radial-gradient(ellipse 60% 55% at 50% 50%, black 10%, rgba(0,0,0,0.5) 35%, rgba(0,0,0,0.15) 55%, transparent 70%)",
                    }}
                  >
                    <Ambience colors={imageColors || []} videoRef={watchVideoRef} videoReady={videoRefReady} />
                  </div>
                </div>
              )}
            </div>

            {!theaterMode && seriesAboveContentMobile}

            {
              !theaterMode && (
                <div className="z-[100000] max-lg:rounded-none max-lg:p-0">
                  {contentColumn}
                </div>
              )
            }
          </div>
          {
            !theaterMode ? 
            relatedColumn :
            (
              <div className="z-[100000] mx-auto max-lg:px-0 px-2 py-4">
                <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3 lg:gap-6 xl:gap-8">
                  <div className="min-w-0 max-lg:rounded-none max-lg:p-0 space-y-3 sm:space-y-4 lg:col-span-2">
                    {seriesAboveContentMobile}
                    <div className="max-lg:rounded-none max-lg:p-0">
                      {contentColumn}
                    </div>
                  </div>
                  {relatedColumn}
                </div>
              </div>
            )
          }
        </div>
      </div>
    </div>
    </>
  );
}
export default index