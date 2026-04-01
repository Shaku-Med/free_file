import { data, Link, useLoaderData, useNavigate, useParams, useNavigation, useLocation, useSearchParams, type MetaFunction } from "react-router";
import db from "~/lib/Database/supabase";
import HLSPlayer from "~/components/components/hlsplayer";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import RelatedVideos from "./components/RelatedVideos";
import SeriesEpisodesSection from "./components/SeriesEpisodesSection";
import type { FileType, SeriesEpisodeGroup } from "~/lib/types";
import {
  collectSeriesMemberIds,
  getSeriesUpNextVideos,
  groupSeriesRpcRows,
  mapSeriesRpcRowToFileType,
} from "./fun/mapSeriesRpcRows";
import { BASE_URL } from "~/lib/URLS";
import { buildPageMeta } from "~/lib/seo";
import ImageLoad from "../Home/components/ImageLoad/ImageLoad";
import { arrangeDateForThumbnail, ParseFilename, getVideoSrc, getThumbnailUrl } from "~/lib/utils";
import { motion } from "framer-motion";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { useSidebar } from "~/components/ui/sidebar";
import { useStandalone } from "~/lib/hooks/useStandalone";
import { checkFileAccess } from "./fun/accessControl";
import AdultContentBadge from "./components/AdultContentBadge";
import ImagePreview from "./components/ImagePreview/ImagePreview";
import Actions from "../Home/components/VideoCard/Actions";
import { isAuthenticated } from "~/lib/Security/Password";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
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
import { useMiniPlayerContext } from "~/lib/Context/MiniPlayerContext";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import LiquidAmbientGradient from "./components/LiquidAmbientGradient";

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
}

export const loader = async ({ request, params }: { request: Request, params: { id: string } }) => {
  try {
    if(!db){
      throw new Error('Database not initialized');
    }

    const { data: file, error } = await db
      .from('files')
      .select('*')
      .eq('unique_id', params.id).maybeSingle();

    if (error) {
      console.error('Error fetching file:', error);
      throw new Error('Failed to fetch file');
    }

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

    const { data: relatedRows, error: relatedError } = await db.rpc('get_related', {
      p_file_id: file.id,
      p_user_id: userId,
      p_limit: 20,
      p_cursor_pos: 0,
    });

    let relatedVideos: FileType[] = [];
    if (!relatedError && relatedRows && relatedRows.length > 0) {
      const filtered = await filterFilesByAccess(request, relatedRows);
      relatedVideos = filtered.map((row: Record<string, unknown>) => ({
        id: row.id,
        created_at: row.created_at,
        endpoint: row.endpoint || '',
        filename: row.filename,
        unique_id: row.unique_id,
        file_size: row.file_size,
        file_type: row.file_type,
        is_adult: row.is_adult,
        owner_id: row.owner_id,
        is_public: row.is_public,
        file_description: row.file_description,
        file_title: row.file_title || '',
        default_thumbnail: row.default_thumbnail || null,
        view_count: row.view_count,
        share_count: row.share_count,
        is_reel: row.is_reel,
        duration: row.duration,
        categories: row.categories,
        tags: row.tags,
        colors: row.colors,
        metadata: row.metadata,
        like_count: Number(row.like_count) || 0,
        dislike_count: Number(row.dislike_count) || 0,
        comment_count: Number(row.comment_count) || 0,
        owner: row.owner_username
          ? {
              id: row.owner_id,
              username: row.owner_username,
              profile_pic: row.owner_profile_pic || '',
              verified: row.owner_verified ?? false,
              about: row.owner_about ?? null,
            }
          : null,
      })) as FileType[];
    }

    let seriesEpisodes: SeriesEpisodeGroup[] | null = null;
    let seriesContext: { fileSeriesId: string } | null = null;
    const seriesVideosUserActions = { likedFileIds: [] as string[], dislikedFileIds: [] as string[] };

    if (file.file_series_id && file.owner_id) {
      const { data: seriesRows, error: seriesErr } = await db.rpc(
        "get_series_episodes_with_items_for_viewer",
        {
          p_file_series_id: file.file_series_id,
          p_series_owner_id: file.owner_id,
          p_viewer_id: userId,
        }
      );
      if (!seriesErr && Array.isArray(seriesRows) && seriesRows.length > 0) {
        const forAccess = (seriesRows as Record<string, unknown>[]).map((r) => {
          const base = mapSeriesRpcRowToFileType(r);
          return {
            ...base,
            is_adult: Boolean(r.is_adult),
            is_public: r.is_public !== false,
            owner_id: String(r.owner_id ?? base.owner_id ?? ""),
            upload_status: typeof r.upload_status === "string" ? r.upload_status : undefined,
          };
        });
        const allowed = await filterFilesByAccess(request, forAccess);
        const allowedIds = new Set(allowed.map((f) => f.id).filter(Boolean));
        const filtered = (seriesRows as Record<string, unknown>[]).filter((r) =>
          allowedIds.has(String(r.id))
        );
        const seriesRowsNoAdult = filtered.filter((r) => !Boolean(r.is_adult));
        if (seriesRowsNoAdult.length > 0) {
          seriesEpisodes = groupSeriesRpcRows(seriesRowsNoAdult);
          seriesContext = { fileSeriesId: String(file.file_series_id) };
          for (const r of seriesRowsNoAdult) {
            if (r.user_has_liked) seriesVideosUserActions.likedFileIds.push(String(r.id));
            if (r.user_has_disliked) seriesVideosUserActions.dislikedFileIds.push(String(r.id));
          }
        }
      }
    }

    let userLiked = false;
    let userDisliked = false;
    let likeCount = 0;
    let dislikeCount = 0;
    let relatedVideosUserActions = { likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() };

    if (file.id) {
      const { data: interactionsData } = await db.rpc('get_file_interactions', {
        p_file_id: file.id,
        p_user_id: user?.id ?? null,
      });
      const interactions = Array.isArray(interactionsData) ? interactionsData[0] : interactionsData;
      if (interactions) {
        likeCount = Number(interactions.like_count) || 0;
        dislikeCount = Number(interactions.dislike_count) || 0;
        userLiked = !!interactions.user_has_liked;
        userDisliked = !!interactions.user_has_disliked;
      }
    }

    if (relatedVideos.length > 0) {
      const relatedFileIds = relatedVideos.map(v => v.id).filter(Boolean);
      if (relatedFileIds.length > 0) {
        const { data: batch } = await db.rpc('get_batch_interactions', {
          p_file_ids: relatedFileIds,
          p_user_id: user?.id ?? null,
        });
        if (Array.isArray(batch)) {
          const interactionsByFile = new Map<
            string,
            { like_count: number; dislike_count: number; comment_count: number; user_has_liked: boolean; user_has_disliked: boolean }
          >();
          for (const row of batch) {
            if (row?.file_id) {
              interactionsByFile.set(row.file_id as string, {
                like_count: Number(row.like_count) ?? 0,
                dislike_count: Number(row.dislike_count) ?? 0,
                comment_count: Number(row.comment_count) ?? 0,
                user_has_liked: !!row.user_has_liked,
                user_has_disliked: !!row.user_has_disliked,
              });
              if (row.user_has_liked) relatedVideosUserActions.likedFileIds.add(row.file_id as string);
              if (row.user_has_disliked) relatedVideosUserActions.dislikedFileIds.add(row.file_id as string);
            }
          }
          relatedVideos = relatedVideos.map((v) => {
            const ix = v.id ? interactionsByFile.get(v.id) : undefined;
            if (!ix) return v;
            return { ...v, like_count: ix.like_count, dislike_count: ix.dislike_count, comment_count: ix.comment_count };
          });
        }
      }
    }

    let owner = null;
    let channelStats: { subscriber_count: number; is_subscribed: boolean; notify: boolean } | null = null;
    if (file.owner_id) {
      const [ownerResult, statsResult] = await Promise.all([
        db.from('users').select('id, username, profile_pic, verified').eq('id', file.owner_id).maybeSingle(),
        db.rpc('get_channel_stats', { p_user_id: file.owner_id, p_viewer_id: userId }),
      ]);

      if (ownerResult.data) {
        owner = {
          id: ownerResult.data.id,
          username: ownerResult.data.username,
          profile_pic: ownerResult.data.profile_pic,
          verified: ownerResult.data.verified ?? false,
        };
      }

      if (statsResult.data) {
        const stats = typeof statsResult.data === 'string' ? JSON.parse(statsResult.data) : statsResult.data;
        channelStats = {
          subscriber_count: Number(stats.subscriber_count) || 0,
          is_subscribed: !!stats.is_subscribed,
          notify: stats.notify !== false,
        };
      }
    }

    let commentsCount = 0;
    if (file.id) {
      const commentsCountResult = await commentService.getCommentsCount(file.id, userId);
      commentsCount = commentsCountResult.data || 0;
    }

    return data({
      file,
      id: params.id,
      relatedVideos,
      userLiked,
      userDisliked,
      likeCount,
      dislikeCount,
      userId,
      owner,
      channelStats,
      commentsCount,
      relatedVideosUserActions: {
        likedFileIds: Array.from(relatedVideosUserActions.likedFileIds),
        dislikedFileIds: Array.from(relatedVideosUserActions.dislikedFileIds),
      },
      seriesEpisodes,
      seriesContext,
      seriesVideosUserActions: {
        likedFileIds: seriesVideosUserActions.likedFileIds,
        dislikedFileIds: seriesVideosUserActions.dislikedFileIds,
      },
      accessDenied: false as const,
      reason: undefined
    }, { 
      status: 200,
      headers: headers as unknown as HeadersInit
     });
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

function blendDynamicData(cached: DynamicCachePayload, fresh: DynamicCachePayload): DynamicCachePayload {
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

  return {
    file: fresh.file,
    id: fresh.id,
    relatedVideos: blendedRelated,
    userLiked: fresh.userLiked,
    userDisliked: fresh.userDisliked,
    likeCount: fresh.likeCount,
    dislikeCount: fresh.dislikeCount,
    userId: fresh.userId,
    owner: fresh.owner ?? cached.owner,
    channelStats: fresh.channelStats ?? cached.channelStats ?? null,
    commentsCount: fresh.commentsCount,
    relatedVideosUserActions: { likedFileIds: mergedLiked, dislikedFileIds: mergedDisliked },
    seriesEpisodes: fresh.seriesEpisodes,
    seriesContext: fresh.seriesContext,
    seriesVideosUserActions:
      fresh.seriesVideosUserActions ??
      (cached as Partial<DynamicCachePayload>).seriesVideosUserActions ??
      { likedFileIds: [], dislikedFileIds: [] },
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
  const hasCachedRef = useRef<string | null>(null);

  const [playingVideos, setPlayingVideos] = useState<Set<number>>(new Set());
  const loaderData = useLoaderData<typeof loader>();

  const cached = getFromCache(pathname);
  const cachedData = cached?.data as DynamicCachePayload | undefined;

  const loaderValid = !!(loaderData && loaderData.file && !loaderData.accessDenied);
  const cacheValid = !!(cachedData?.file && cachedData?.id === currentId);

  const effectiveData = useMemo((): DynamicCachePayload | null => {
    if (cacheValid && loaderValid && cachedData && loaderData) {
      const freshPayload: DynamicCachePayload = {
        file: loaderData.file,
        id: loaderData.id ?? currentId ?? '',
        relatedVideos: ('relatedVideos' in loaderData ? loaderData.relatedVideos : []) as FileType[],
        userLiked: ('userLiked' in loaderData && loaderData.userLiked) || false,
        userDisliked: ('userDisliked' in loaderData && loaderData.userDisliked) || false,
        likeCount: Number(loaderData.likeCount) || 0,
        dislikeCount: Number(loaderData.dislikeCount) || 0,
        userId: ('userId' in loaderData ? loaderData.userId : null) as string | null,
        owner: ('owner' in loaderData ? loaderData.owner : null) as any,
        channelStats: ('channelStats' in loaderData ? loaderData.channelStats : null) as any,
        commentsCount: ('commentsCount' in loaderData ? loaderData.commentsCount : 0) as number,
        relatedVideosUserActions: ('relatedVideosUserActions' in loaderData ? loaderData.relatedVideosUserActions : { likedFileIds: [], dislikedFileIds: [] }) as any,
        seriesEpisodes: ('seriesEpisodes' in loaderData ? loaderData.seriesEpisodes : null) as SeriesEpisodeGroup[] | null,
        seriesContext: ('seriesContext' in loaderData ? loaderData.seriesContext : null) as { fileSeriesId: string } | null,
        seriesVideosUserActions: ('seriesVideosUserActions' in loaderData && loaderData.seriesVideosUserActions
          ? loaderData.seriesVideosUserActions
          : { likedFileIds: [], dislikedFileIds: [] }) as DynamicCachePayload['seriesVideosUserActions'],
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
      } as DynamicCachePayload;
    }

    if (loaderValid && loaderData) {
      return {
        file: loaderData.file,
        id: loaderData.id ?? currentId ?? '',
        relatedVideos: ('relatedVideos' in loaderData ? loaderData.relatedVideos : []) as FileType[],
        userLiked: ('userLiked' in loaderData && loaderData.userLiked) || false,
        userDisliked: ('userDisliked' in loaderData && loaderData.userDisliked) || false,
        likeCount: Number(loaderData.likeCount) || 0,
        dislikeCount: Number(loaderData.dislikeCount) || 0,
        userId: ('userId' in loaderData ? loaderData.userId : null) as string | null,
        owner: ('owner' in loaderData ? loaderData.owner : null) as any,
        channelStats: ('channelStats' in loaderData ? loaderData.channelStats : null) as any,
        commentsCount: ('commentsCount' in loaderData ? loaderData.commentsCount : 0) as number,
        relatedVideosUserActions: ('relatedVideosUserActions' in loaderData ? loaderData.relatedVideosUserActions : { likedFileIds: [], dislikedFileIds: [] }) as any,
        seriesEpisodes: ('seriesEpisodes' in loaderData ? loaderData.seriesEpisodes : null) as SeriesEpisodeGroup[] | null,
        seriesContext: ('seriesContext' in loaderData ? loaderData.seriesContext : null) as { fileSeriesId: string } | null,
        seriesVideosUserActions: ('seriesVideosUserActions' in loaderData && loaderData.seriesVideosUserActions
          ? loaderData.seriesVideosUserActions
          : { likedFileIds: [], dislikedFileIds: [] }) as DynamicCachePayload['seriesVideosUserActions'],
      };
    }

    return null;
  }, [loaderValid, cacheValid, loaderData, cachedData, currentId]);

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

  const mergedSidebarUserActions = useMemo(
    () => ({
      likedFileIds: new Set([
        ...(data?.relatedVideosUserActions?.likedFileIds ?? []),
        ...(data?.seriesVideosUserActions?.likedFileIds ?? []),
      ]),
      dislikedFileIds: new Set([
        ...(data?.relatedVideosUserActions?.dislikedFileIds ?? []),
        ...(data?.seriesVideosUserActions?.dislikedFileIds ?? []),
      ]),
    }),
    [data?.relatedVideosUserActions, data?.seriesVideosUserActions]
  );

  const [views, setViews] = useState<number>(Number(file_data?.views || file_data?.view_count || 0));
  const [shares, setShares] = useState<number>(Number(file_data?.shares || file_data?.share_count || 0));
  const [hasIncrementedView, setHasIncrementedView] = useState(false);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [videoRefReady, setVideoRefReady] = useState(false);
  const { activateMiniPlayer, miniPlayer: activeMiniPlayer, signalMainPlayerReady, isExpanding, expandPlaybackState, sourceVideoRef } = useMiniPlayerContext();
  const activeMiniPlayerRef = useRef(activeMiniPlayer);
  activeMiniPlayerRef.current = activeMiniPlayer;

  // If expanding from mini player with matching ID, use mini player's current time + settings
  const expandMatch = expandPlaybackState && expandPlaybackState.fileId === currentId ? expandPlaybackState : null;
  const startTime = expandMatch?.currentTime ?? startTimeFromParam;

  const prevIdRef = useRef<string | undefined>(currentId);
  const viewIncrementSentRef = useRef(false);

  useEffect(() => {
    if (prevIdRef.current && prevIdRef.current !== currentId) {
      setPlayingVideos(new Set());
      setHasIncrementedView(false);
      viewIncrementSentRef.current = false;
      setRetryAttempt(0);
      setImageUrl(null);
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
      <div className="flex items-center justify-center min-h-screen py-6 px-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="w-16 h-16 mx-auto text-muted-foreground" />
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-muted-foreground">{message}</p>
          {action && (
            <Link
              className="px-4 py-2 text-sm font-medium text-white border cursor-pointer border-white/40 rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white transition"
              to={action}
            >
              {actionText}
            </Link>
          )}
        </div>
      </div>
    );
  }
  
  if(!file_data || !data) {
    return (
      <div className="flex items-center justify-center text-2xl py-6 px-4 min-h-[200px]">
        <h1>File not found</h1>
      </div>
    );
  }

  const isHLS = file_data?.file_type === 'application/vnd.apple.mpegurl' || file_data?.endpoint?.includes('.m3u8');
  const isVideo = isHLS || file_data?.file_type?.includes('video');

  const { theaterMode, setTheaterMode, userId } = useFileContext();


  useWatchTracking({
    fileId: file_data?.id || '',
    userId: userId,
    isVideo: isVideo,
    videoElement: videoElementRef.current,
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
  const [imageUrl, setImageUrl] = useState<{ url: string, imageID: string } | null>(null)
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
  const {isMobile, state} = useSidebar();
  const isStandalone = useStandalone();
  

  useEffect(() => {
    if (!file_data || !data) return;
    setLiked(data.userLiked || false);
    setDisliked(data.userDisliked || false);
    setLikeCount(Number(data.likeCount) || 0);
    setDislikeCount(Number(data.dislikeCount) || 0);
  }, [currentId, file_data?.id]);

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
    if (!expandMatch || appliedExpandRef.current) return;
    const video = videoElementRef.current;
    if (!video) return;

    const applyExpandState = () => {
      if (appliedExpandRef.current) return;
      appliedExpandRef.current = true;
      video.volume = expandMatch.volume;
      video.muted = expandMatch.muted;
      video.playbackRate = expandMatch.playbackRate;
      if (expandMatch.wasPlaying) {
        video.play().catch(() => {});
      }
    };

    if (video.readyState >= 2) {
      applyExpandState();
    } else {
      video.addEventListener('canplay', applyExpandState, { once: true });
      return () => video.removeEventListener('canplay', applyExpandState);
    }
  }, [expandMatch]);

  const handleVideoRef = useCallback((ref: HTMLVideoElement | null) => {
    setVideoRefReady(!!ref);
  }, [])

  const handleVideoSelect = useCallback((video: FileType) => {
    navigate(`/${video.unique_id}`);
  }, [navigate])

  const relatedVideos = data.relatedVideos ?? [];
  const seriesMemberIds = useMemo(
    () => collectSeriesMemberIds(data?.seriesEpisodes ?? null),
    [data?.seriesEpisodes]
  );
  const seriesUpNextVideos = useMemo(
    () => getSeriesUpNextVideos(data?.seriesEpisodes ?? null, currentId ?? ""),
    [data?.seriesEpisodes, currentId]
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

  const runViewIncrement = useCallback(() => {
    if (!file_data?.id || !file_data?.unique_id || hasIncrementedView || viewIncrementSentRef.current) return;
    viewIncrementSentRef.current = true;
    const payload = {
      fileId: file_data.id,
      uniqueId: file_data.unique_id,
      minimumWatchSeconds: requiredViewSeconds,
      ...(file_data.duration != null && { durationSeconds: Number(file_data.duration) }),
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

  const viewIncrementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVideoPlayForView = useCallback(() => {
    if (hasIncrementedView || viewIncrementSentRef.current || viewIncrementTimerRef.current) return;
    viewIncrementTimerRef.current = setTimeout(() => {
      viewIncrementTimerRef.current = null;
      runViewIncrement();
    }, requiredViewSeconds * 1000);
  }, [hasIncrementedView, runViewIncrement, requiredViewSeconds]);

  useEffect(() => () => {
    if (viewIncrementTimerRef.current) clearTimeout(viewIncrementTimerRef.current);
  }, []);

  const fileDataRef = useRef(file_data);
  fileDataRef.current = file_data;
  const isHLSRef = useRef(false);

  useEffect(() => {
    const fd = fileDataRef.current;
    isHLSRef.current = fd?.file_type === 'application/vnd.apple.mpegurl' || !!fd?.endpoint?.includes('.m3u8');
  });

  useEffect(() => {
    return () => {
      // Don't override if mini player was already activated (e.g. by the button)
      if (activeMiniPlayerRef.current) return;
      const video = videoElementRef.current;
      const fd = fileDataRef.current;
      if (!video || !fd || !isHLSRef.current) return;
      if (video.paused || video.ended) return;
      activateMiniPlayer({
        src: getVideoSrc(fd.endpoint ?? '', fd.file_type),
        file: fd,
        currentTime: video.currentTime,
        imageID: fd.unique_id,
        wasPlaying: !video.paused,
        volume: video.volume,
        muted: video.muted,
        playbackRate: video.playbackRate,
      });
    };
  }, [activateMiniPlayer, currentId]);

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
      <div className={` relative w-full
        ${theaterMode 
          ? "max-h-[calc(100vh-64px)] aspect-video mx-auto" 
          : "aspect-video"
        }
      `}>
        {isHLS ? (
          <HLSPlayer
            videoRef={videoElementRef as React.RefObject<HTMLVideoElement>}
            src={getVideoSrc(file_data?.endpoint ?? '', file_data?.file_type)}
            className={`w-full h-full`}
            onPlay={() => {
              setPlayingVideos(prev => new Set(prev).add(1));
              onVideoPlayForView();
              signalMainPlayerReady();
            }}
            onPause={() => setPlayingVideos(prev => {
              const newSet = new Set(prev);
              newSet.delete(1);
              return newSet;
            })}
            autoPlay={true}
            muted={false}
            playsInline
            imageID={file_data.unique_id}
            file={{ ...file_data, owner: data?.owner }}
            key={`hls-${file_data.unique_id}-${currentId}`}
            onVideoRef={handleVideoRef}
            callBack={hlsCallBack}
            suggestedVideos={suggestedVideos}
            seriesUpNextVideos={seriesUpNextVideos}
            endScreenUserActions={mergedSidebarUserActions}
            currentUserId={userId || undefined}
            onVideoSelect={handleVideoSelect}
            onAmbientModeChange={setAmbientEnabled}
            startTime={startTime}
          />
        ) : (
          <motion.div 
            transition={{ duration: 0.1 }} 
            onClick={() => {
              if(madeImageUrl) {
                setImageUrl({ url: madeImageUrl, imageID: file_data.unique_id })
              }
            }} 
            layoutId={`image_id_${file_data.unique_id}`} 
            className="w-full aspect-video cursor-zoom-in relative"
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
    <div className="space-y-4 z-[10000] relative rounded-lg overflow-hidden p-4">
      {/* <div className="dim_top bg-muted/20 absolute top-0 left-0 w-full h-full z-[1]" /> */}
      <LiquidAmbientGradient colors={file_data.colors} />
      <h1 className="text-xl font-bold text-foreground leading-tight select-text z-[10000]">
        <ParseFilenameInsert filename={file_data.file_title || file_data.filename}/>  
      </h1>

      {data.owner && (
        <div className="flex items-center justify-between gap-3">
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
        likeCount={likeCount}
        dislikeCount={dislikeCount}
        commentCount={commentsCount}
        liked={liked}
        disliked={disliked}
        isOwner={isOwner}
        onEdit={undefined}
        onUpdate={userId ? handleInteractionUpdate : undefined}
        getShareTimestamp={isHLS ? () => videoElementRef.current?.currentTime ?? 0 : undefined}
        onShareSuccess={(serverCount) => {
          if (typeof serverCount === "number" && !Number.isNaN(serverCount)) setShares(serverCount);
          else setShares((s) => s + 1);
        }}
        currentTime={isHLS ? (videoElementRef.current?.currentTime ?? 0) : undefined}
        currentUserId={userId}
        isAdult={file_data.is_adult}
      />

      <div className="rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground pt-3 pb-1">
          <span className="font-medium text-foreground">{formatNumber(views)} views</span>
          {file_data.created_at ? (
            <span>
              {new Date(file_data.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}{" "}
              · {formatTimeAgo(file_data.created_at)}
            </span>
          ) : null}
          {/* {shares > 0 && (
            <>
              <span aria-hidden>•</span>
              <span>{formatNumber(shares)} shares</span>
            </>
          )} */}
        </div>
        {(description || hasLongDescription) && (
          <div className=" p-2 border rounded-lg bg-muted/10 overflow-auto">
            <div className="text-sm text-foreground break-words">
              <FormattedText text={descriptionToShow} />
              {hasLongDescription && !descriptionExpanded && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => setDescriptionExpanded(true)}
                    className="font-medium text-foreground hover:underline inline-flex items-center gap-0.5"
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

      <div id="comments" className="scroll-mt-24">
        <CommentSection
          key={`comments-${file_data.id}-${currentId}-${highlightCommentId ?? ""}`}
          fileId={file_data.id}
          currentUserId={userId || undefined}
          fileOwnerId={file_data.owner_id || undefined}
          commentsEnabled={file_data.comments_enabled !== false}
          highlightCommentId={highlightCommentId}
          commentImageDateFolder={
            file_data.created_at ? arrangeDateForThumbnail(file_data.created_at) : undefined
          }
          commentImageFileUniqueId={file_data.unique_id}
        />
      </div>
    </div>
  );

  const relatedColumn = (
    <div className="lg:col-span-1">
      <div className="sticky top-6">
        {data.seriesEpisodes && data.seriesEpisodes.length > 0 && (
          <div className="hidden lg:block">
            <SeriesEpisodesSection
              episodes={data.seriesEpisodes}
              currentVideoUniqueId={file_data.unique_id}
              currentUserId={userId || undefined}
              userActions={mergedSidebarUserActions}
            />
          </div>
        )}
        <RelatedVideos
          key={`related-${file_data.unique_id}-${currentId}`}
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
  );

  return (
    <div className="relative min-h-screen reel_p" key={`dynamic-${currentId}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className={`relative z-10 mx-auto max-w-full `}>
        <div className={`${!theaterMode ? `grid grid-cols-1 lg:grid-cols-3 gap-6` : ``}`}>
          <div className={`${!theaterMode ? `lg:col-span-2 space-y-4` : ``}`}>
            <div className="relative">
              {videoBlock}
              {ambientEnabled && (
                <div className={`ambience-wrap z-[-1] absolute scale-[1.8] w-full min-w-screen h-full inset-0 pointer-events-none overflow-hidden rounded-lg ${isMobile && `blur-lg`}`}>
                  {
                    isMobile && (
                      <>
                        <div className="mobile_blur_overlay absolute inset-x-0 bottom-0 h-full z-[10] bg-gradient-to-t from-background/95 via-background/60 to-transparent" />
                      </>
                    )
                  }
                  <div className="absolute inset-0">
                    <Ambience colors={imageColors || []} videoRef={videoElementRef} videoReady={videoRefReady} />
                  </div>
                  <div
                    className="gradient-overlay absolute inset-0  pointer-events-none"
                    style={{
                      background: state !== 'expanded' || isMobile
                        ? `linear-gradient(to bottom, var(--background) 0%, transparent 12%, transparent 88%, var(--background) 100%)`
                        : `radial-gradient(ellipse 100% 100% at 50% 50%, transparent 10%, var(--card) 50%, var(--card) 100%)`
                    }}
                  />
                </div>
              )}
            </div>

            {!theaterMode && data.seriesEpisodes && data.seriesEpisodes.length > 0 && (
              <div className="z-[100000] lg:hidden -mt-1">
                <SeriesEpisodesSection
                  episodes={data.seriesEpisodes}
                  currentVideoUniqueId={file_data.unique_id}
                  currentUserId={userId || undefined}
                  userActions={mergedSidebarUserActions}
                />
              </div>
            )}

            {
              !theaterMode && (
                <div className="z-[100000]">
                  {contentColumn}
                </div>
              )
            }
          </div>
          {
            !theaterMode ? 
            relatedColumn :
            (
              <div className="mx-auto py-4 px-2 z-[100000]">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  {contentColumn}
                </div>
                {relatedColumn}
              </div>
            </div>
            )
          }
        </div>
      </div>
    </div>
  );
}
export default index