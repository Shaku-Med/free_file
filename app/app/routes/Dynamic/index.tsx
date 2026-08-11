import { data, Link, useLoaderData, useNavigate, useParams, useNavigation, useLocation, useSearchParams, useRevalidator, type MetaFunction } from "react-router";
import WatchModalShell from "~/components/WatchModalShell";
import db from "~/lib/Database/supabase";
import { WatchPlayBootstrapSync } from "./components/WatchPlayBootstrapSync";
import { useCallback, useEffect, useLayoutEffect, useState, useRef, useMemo } from "react";
import RelatedVideos from "./components/RelatedVideos";
import SeriesEpisodesSection from "./components/SeriesEpisodesSection";
import ImageWatchCarousel from "./components/ImageWatchCarousel";
import { Carousel, CarouselItem } from "~/components/Carousel/Carousel";
import SeriesSignInGate from "./components/SeriesSignInGate";
import { getSeriesUpNextVideos } from "./fun/mapSeriesRpcRows";
import { type FileType, type SeriesEpisodeGroup, type ImageContentPayload, fileWatchPath } from "~/lib/types";
import { BASE_URL } from "~/lib/URLS";
import { buildVideoObject, videoPreviewMeta } from "~/lib/seo/videoPreview";
import { buildPageMeta } from "~/lib/seo";
import ImageLoad from "../Home/components/ImageLoad/ImageLoad";
import { ParseFilename, getVideoSrc, getThumbnailUrl, getThumbnailPreviewApiPaths, cn } from "~/lib/utils";
import { usePlaybackUrl } from "~/lib/hooks/usePlaybackUrl";
import { resolvePlaybackSrc } from "~/lib/playbackUrlCache";
import { motion } from "framer-motion";
import { ChevronDown, MessageCircle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useSidebar } from "~/components/ui/sidebar";
import { useStandalone } from "~/lib/hooks/useStandalone";
import { stripGithubRepoForClient } from "~/lib/githubStorage";
import { checkFileAccess } from "./fun/accessControl";
import AdultContentBadge from "./components/AdultContentBadge";
import Actions from "../Home/components/VideoCard/Actions";
import VideoCard from "../Home/components/VideoCard";
import { isAuthenticated } from "~/lib/Security/Password";
import CommentSection from "./components/Comments/CommentSection";
import { FormattedText } from "~/components/FormattedText";
import OriginalSoundCard from "./components/OriginalSoundCard";
import AcoustidRecordingCard from "./components/AcoustidRecordingCard";
import WatchLink from "~/components/WatchLink";
import { fileHoverTint } from "~/components/components/hlsplayer/visualizerPalette";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import SubscribeButton, { formatSubscriberCount } from "~/components/SubscribeButton";
import { formatNumber } from "~/lib/utils/formatNumber";
import { formatExactDate } from "~/lib/utils/formatExactDate";
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
import { computeGuestPreviewSeconds } from "~/lib/guestPreviewLimit";
import { sanitizeFileForPublicViewer } from "~/lib/files/sanitizeFileForViewer";
import { personalizationService } from "~/lib/Services/PersonalizationService";

import type { DynamicCachePayload, FreshForBlend, DynamicDeferredDetails } from "./types";
import { loadDynamicPageDetails } from "./fun/loadDetails";
import { soundRemixToFileType } from "./fun/soundRemix";
import { buildDynamicMeta } from "./fun/meta";
import { blendDynamicData } from "./fun/blendDynamicData";

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

    // Playback URL is NOT minted here. It would land in the HTML / loader
    // JSON where view-source / scrapers could harvest it. The client
    // calls POST /api/play/mint just-in-time and receives a token bound
    // to its own IP + UA. Loader stays free of any signed URL.

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


export const meta: MetaFunction<ReturnType<typeof loader>> = ({ data }: { data: any }) =>
  buildDynamicMeta(data);

interface DynamicPageProps {
  is_modal?: boolean;
}
const DynamicPage = ({ is_modal }: DynamicPageProps) => {
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
    playerSettings,
    userId,
    getDynamicSeriesPayloadCache,
    setDynamicSeriesPayloadCache,
    getRelatedVideosPayloadCache,
    setRelatedVideosPayloadCache,
    getImageContent,
    setImageContent,
  } = useFileContext();

  // Layout animation is enabled only for the theater toggle, and only on
  // desktop. layoutId animates EVERY size change otherwise, so a window resize
  // or the aspect settling after metadata reads as an unwanted zoom.
  const [animateTheater, setAnimateTheater] = useState(false);
  const theaterFirstRun = useRef(true);
  useEffect(() => {
    if (theaterFirstRun.current) {
      theaterFirstRun.current = false;
      return;
    }
    if (isMobileDevice) return;
    setAnimateTheater(true);
    const t = setTimeout(() => setAnimateTheater(false), 420);
    return () => clearTimeout(t);
  }, [theaterMode]);

  const playerBackground = playerSettings?.playerBackground !== false;
  const ambientSyncOn = playerSettings?.ambientSync === true;
  const ambientSizeMul = Math.max(1, Math.min(2, playerSettings?.ambientSize ?? 2));
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

  // Reel-style image swiping: the carousel changes the URL with replaceState
  // (no loader re-run) and hands us the active image here. We swap the page's
  // per-image fields from the strip item instantly, then refine from a cached
  // GET /api/content/:id. Null = not overriding (videos, or the seed image).
  type ImageOverride = {
    id: string;
    file: FileType;
    owner: { id: string; username: string; profile_pic: string; verified: boolean } | null;
    likeCount: number;
    dislikeCount: number;
    commentsCount: number;
    userLiked: boolean;
    userDisliked: boolean;
  };
  const [imageOverride, setImageOverride] = useState<ImageOverride | null>(null);
  const imageContentReqRef = useRef(0);

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

  // When the image carousel is driving (imageOverride set), swap only the
  // per-image fields onto effectiveData; related videos / series stay intact.
  const displayData = useMemo((): DynamicCachePayload | null => {
    if (!effectiveData) return effectiveData;
    if (!imageOverride || !imageOverride.file?.id) return effectiveData;
    return {
      ...effectiveData,
      file: imageOverride.file,
      id: imageOverride.id,
      owner: imageOverride.owner as DynamicCachePayload["owner"],
      likeCount: imageOverride.likeCount,
      dislikeCount: imageOverride.dislikeCount,
      userLiked: imageOverride.userLiked,
      userDisliked: imageOverride.userDisliked,
      commentsCount: imageOverride.commentsCount,
    };
  }, [effectiveData, imageOverride]);

  const file_data = displayData?.file;
  const data = displayData;

  // A real navigation (fresh load, related-image link) resets the override so
  // the new page shows its own loader data. Carousel swipes use replaceState,
  // which does not change currentId, so they don't trip this.
  useEffect(() => {
    setImageOverride(null);
  }, [currentId]);

  // Called by ImageWatchCarousel on each settled slide. Instant swap from the
  // strip item, then refine from the per-image content cache / a light GET.
  const handleCarouselActive = useCallback(
    (img: Record<string, unknown> & { unique_id?: string | null; id?: string | number | null }) => {
      const uid = String(img.unique_id ?? img.id ?? "");
      if (!uid) return;

      const cached = getImageContent(uid);
      const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      setImageOverride({
        id: uid,
        file: (cached?.file ?? (img as unknown as FileType)),
        owner: cached?.owner ?? null,
        likeCount: cached?.likeCount ?? num(img.like_count),
        dislikeCount: cached?.dislikeCount ?? num(img.dislike_count),
        commentsCount: cached?.commentCount ?? num(img.comment_count),
        userLiked: cached?.userLiked ?? false,
        userDisliked: cached?.userDisliked ?? false,
      });

      const title = (img.file_title as string) || (img.filename as string) || "";
      if (typeof document !== "undefined" && title) document.title = `${title} | Memories`;

      if (cached) return;
      const reqId = ++imageContentReqRef.current;
      void (async () => {
        try {
          const res = await fetch(`/api/content/${encodeURIComponent(uid)}`, {
            credentials: "include",
          });
          if (!res.ok) return;
          const json = (await res.json()) as Partial<ImageContentPayload> & { file?: FileType };
          if (!json?.file) return;
          const payload: ImageContentPayload = {
            file: json.file,
            owner: json.owner ?? null,
            likeCount: num(json.likeCount),
            dislikeCount: num(json.dislikeCount),
            commentCount: num(json.commentCount),
            userLiked: !!json.userLiked,
            userDisliked: !!json.userDisliked,
          };
          setImageContent(uid, payload);
          // Ignore if the viewer has since swiped to a different image.
          if (reqId !== imageContentReqRef.current) return;
          setImageOverride((prev) =>
            prev && prev.id === uid
              ? {
                  id: uid,
                  file: payload.file,
                  owner: payload.owner,
                  likeCount: payload.likeCount,
                  dislikeCount: payload.dislikeCount,
                  commentsCount: payload.commentCount,
                  userLiked: payload.userLiked,
                  userDisliked: payload.userDisliked,
                }
              : prev,
          );
        } catch {
          /* keep the instant override */
        }
      })();
    },
    [getImageContent, setImageContent],
  );

  // JIT signed URL  see ~/lib/hooks/usePlaybackUrl. URL is NEVER in
  // HTML / loader JSON, so view-source / scrapers can't lift it.
  const playbackUrl = usePlaybackUrl(file_data ?? null);

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
  /** Intrinsic video aspect  used to hug the ambience glow to the visible video when the player background is off. */
  const [ambienceVideoAspect, setAmbienceVideoAspect] = useState<number | null>(null);
  // The frame matches the video's real aspect (no black bars), clamped so a
  // portrait or ultrawide clip can't blow up the layout. ~16:9 is unchanged.
  // Falls back to 16:9 until the video's dimensions are known.
  /**
   * Aspect ratio known BEFORE any video bytes load.
   *
   * The frame used to default to 16:9 and then snap once `loadedmetadata` fired,
   * which is the visible jump on portrait/square uploads. The pipeline already
   * stores real dimensions on the row, so use them for the first paint and let
   * the video element merely confirm it — no reflow.
   */
  const dbVideoAspect = useMemo(() => {
    const v = (file_data as { metadata?: { video?: { width?: unknown; height?: unknown; aspect_ratio?: unknown } } })
      ?.metadata?.video;
    if (!v) return null;
    const w = Number(v.width) || 0;
    const h = Number(v.height) || 0;
    if (w > 0 && h > 0) return w / h;
    // Fall back to the stored "W:H" string when explicit dimensions are absent.
    if (typeof v.aspect_ratio === "string" && v.aspect_ratio.includes(":")) {
      const [aw, ah] = v.aspect_ratio.split(":").map(Number);
      if (aw > 0 && ah > 0) return aw / ah;
    }
    return null;
  }, [file_data]);

  /**
   * The frame keeps the file's real aspect. The one exception is a portrait
   * shape: the width is driven by `82vh * aspect`, so the narrower the clip the
   * narrower the whole player gets, and a 9:16 upload ends up a thin column on
   * the watch page. Below the floor we fall back to a normal 16:9 frame and let
   * the video pillarbox inside it, which the element already does via
   * object-contain. Ultrawide stays capped so it cannot flatten the layout.
   */
  const PORTRAIT_FRAME_FLOOR = 1;
  const rawFrameAspect = ambienceVideoAspect ?? dbVideoAspect ?? 16 / 9;
  const playerFrameAspect =
    rawFrameAspect < PORTRAIT_FRAME_FLOOR ? 16 / 9 : Math.min(2.4, rawFrameAspect);
  useEffect(() => {
    if (!videoRefReady) return;
    const v = watchVideoRef.current;
    if (!v) return;
    const update = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setAmbienceVideoAspect(v.videoWidth / v.videoHeight);
      }
    };
    update();
    v.addEventListener("loadedmetadata", update);
    return () => v.removeEventListener("loadedmetadata", update);
  }, [videoRefReady, watchVideoRef, currentId]);
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
   * remount cancels it  slot transitions directly old→new with no gap, so the global
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
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const closeMiniPlayerRef = useRef(closeMiniPlayer);
  closeMiniPlayerRef.current = closeMiniPlayer;

  // THE mini player close decision for watch pages. It lives here - after the
  // loader - because only the loaded file says what the destination IS. Closing
  // on the URL alone (the old CloseMiniPlayerOnNavigateToVideo behavior) killed
  // the mini for image posts too, which never claim the shared <video> at all.
  //  - image  -> keep the mini playing while the viewer looks at pictures
  //  - video  -> the in-page player takes over, close the mini (unless this IS
  //              the mini expanding into the page; that handoff dismisses chrome)
  //  - other  -> close, nothing should fight over playback
  useEffect(() => {
    if (!file_data?.unique_id) return;
    const fd = file_data;
    if (fd.file_type?.startsWith('image/')) return;
    if (!activeMiniPlayer) return;
    if (isExpanding) return;
    closeMiniPlayer();
  }, [
    file_data?.unique_id,
    file_data?.file_type,
    file_data?.endpoint,
    activeMiniPlayer,
    isExpanding,
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
    // Carousel image: keep the per-image cache + override in sync so swiping
    // back to a just-liked image shows the like instead of a stale cached value.
    if (imageOverride) {
      const uid = imageOverride.id;
      const existing = getImageContent(uid);
      if (existing) {
        setImageContent(uid, {
          ...existing,
          userLiked: updates.liked,
          userDisliked: updates.disliked,
          likeCount: updates.like_count,
          dislikeCount: updates.dislike_count,
        });
      }
      setImageOverride((prev) =>
        prev && prev.id === uid
          ? {
              ...prev,
              userLiked: updates.liked,
              userDisliked: updates.disliked,
              likeCount: updates.like_count,
              dislikeCount: updates.dislike_count,
            }
          : prev,
      );
    }
  }

  // Posts/deletes made in this session adjust the loader's count so the
  // number on screen tracks the thread instead of freezing at page load.
  // A delete that takes a whole reply thread with it subtracts the real
  // cascade size, not 1.
  const [commentCountAdj, setCommentCountAdj] = useState(0);
  const commentedFileId = file_data?.id;
  useEffect(() => {
    setCommentCountAdj(0);
  }, [commentedFileId]);
  const handleCommentCountDelta = useCallback((delta: number) => {
    setCommentCountAdj((prev) => prev + delta);
  }, []);

  const commentsCount = Math.max(0, (data.commentsCount || 0) + commentCountAdj);
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

  /** Remaining episodes after the current one, when this file is in a series. */
  const seriesUpNextVideos = useMemo(
    () => getSeriesUpNextVideos(seriesEpisodesResolved, String(file_data?.unique_id ?? "")),
    [seriesEpisodesResolved, file_data?.unique_id],
  );

  /**
   * Up-next for auto-play, taken from data the loader ALREADY sent — no client
   * queue request.
   *
   * Series episodes take over when the file belongs to a series. Otherwise we
   * offer a few similar videos: reels are excluded (they have their own swiper
   * at /reel and shouldn't hijack a watch session), images/audio are excluded
   * because there's nothing to play, and the current file is excluded.
   *
   * Rotated by a seed derived from the current file so different visits surface
   * different neighbours, while a single visit stays stable (no reshuffling
   * under the viewer mid-watch).
   */
  const autoNextVideos = useMemo(() => {
    const AUTO_NEXT_COUNT = 4;
    const currentUid = String(file_data?.unique_id ?? "");
    const playable = (relatedVideos as FileType[]).filter((v) => {
      if (!v || v.is_reel) return false;
      if (String(v.unique_id ?? "") === currentUid) return false;
      const ft = String(v.file_type ?? "").toLowerCase();
      const ep = String(v.endpoint ?? "").toLowerCase();
      return (
        ft.startsWith("video/") ||
        ft === "application/vnd.apple.mpegurl" ||
        ep.includes(".m3u8")
      );
    });
    if (playable.length <= AUTO_NEXT_COUNT) return playable;
    let h = 2166136261;
    for (let i = 0; i < currentUid.length; i++) {
      h ^= currentUid.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const start = (h >>> 0) % playable.length;
    return Array.from(
      { length: AUTO_NEXT_COUNT },
      (_, i) => playable[(start + i) % playable.length],
    );
  }, [relatedVideos, file_data?.unique_id]);

  const isNavigating =
    navigation.state === "loading" &&
    navigation.location != null &&
    navigation.location.pathname !== location.pathname;

  // Pause-during-Dynamic→Dynamic-navigation:
  //   When the next route is also a watch page (single-segment path like
  //   "/<unique_id>"), pause the current video the moment navigation starts.
  //   This stops the old src from continuing to play while the new file_data
  //   streams in. Once navigation finishes and the new playback URL resolves,
  //   useHLS hot-swaps and resumes if the user was playing (or auto-next).
  //
  //   End-of-video auto-next counts as "was playing" even though the element
  //   is ended  otherwise the next video would stay frozen on the last frame.
  const wasPlayingAtNavRef = useRef(false);
  const navTargetFileIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const nextPath = navigation.location?.pathname ?? "";
    const goingToWatchPage = isSingleSegmentWatchPath(nextPath);
    if (!isNavigating || !goingToWatchPage) return;
    const video = watchVideoRef.current;
    if (!video) return;
    navTargetFileIdRef.current = getDynamicVideoIdFromPath(nextPath);
    wasPlayingAtNavRef.current = video.ended || !video.paused;
    try {
      video.pause();
    } catch {
      /* ignore */
    }
  }, [isNavigating, navigation.location?.pathname, location.pathname, watchVideoRef]);

  // After the new file_data is mounted and the new playback URL has resolved,
  // resume playback if the user was playing (or auto-next) before navigation.
  useEffect(() => {
    if (isNavigating || !file_data?.unique_id || !playbackUrl) return;
    if (navTargetFileIdRef.current && navTargetFileIdRef.current !== file_data.unique_id) {
      return;
    }
    if (!wasPlayingAtNavRef.current) {
      navTargetFileIdRef.current = null;
      return;
    }
    wasPlayingAtNavRef.current = false;
    navTargetFileIdRef.current = null;
    const video = watchVideoRef.current;
    if (!video) return;
    const tryPlay = () => {
      void video.play().catch(() => {});
    };
    if (video.readyState >= 2) {
      const id = window.requestAnimationFrame(tryPlay);
      return () => window.cancelAnimationFrame(id);
    }
    video.addEventListener("canplay", tryPlay, { once: true });
    return () => video.removeEventListener("canplay", tryPlay);
  }, [isNavigating, file_data?.unique_id, playbackUrl, location.pathname, watchVideoRef]);

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
          // Studio analytics event. Fires only after the view is counted
          // so we never double record on aborted / spam plays.
          void import('~/lib/studio/track.client').then(({ trackStudioEvent }) => {
            trackStudioEvent({
              type: 'video_view',
              fileId: file_data.id,
              metadata: {
                watchSeconds: Math.round(payload.currentTimeSeconds || 0),
                durationSeconds: Math.round(payload.durationSeconds || 0),
              },
            });
          }).catch(() => {});
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
        src: resolvePlaybackSrc(file_data, { mintedUrl: playbackUrl }),
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
    playbackUrl,
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
   * Don't clear surface on payload swap  that causes a transient `null` between cleanup
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
  const ownerRef = useRef(data?.owner ?? null);
  ownerRef.current = data?.owner ?? null;
  const playbackUrlRef = useRef<string | null>(playbackUrl);
  playbackUrlRef.current = playbackUrl;
  const isHLSRef = useRef(false);

  useEffect(() => {
    const fd = fileDataRef.current;
    isHLSRef.current = fd?.file_type === 'application/vnd.apple.mpegurl' || !!fd?.endpoint?.includes('.m3u8');
  });

  /* Full unmount of the watch index only (not param swaps on the same route). */
  useEffect(() => {
    return () => {
      if (!userIdRef.current) {
        closeMiniPlayerRef.current();
        try {
          watchVideoRef.current?.pause();
        } catch {
          /* ignore */
        }
        return;
      }
      if (activeMiniPlayerRef.current) return;
      const path = typeof window !== "undefined" ? window.location.pathname : "";
      const destId = getDynamicVideoIdFromPath(path);
      // Race-defense: URL still says we're on this watch page (unmount without nav)  leave the player alone.
      if (destId && fileDataRef.current && destId === fileDataRef.current.unique_id) return;
      // Different watch ID is taking over  let it own the handoff.
      if (isSingleSegmentWatchPath(path)) return;
      // Reel owns the global player  no mini handoff, just tear down.
      if (path === "/reel" || path.startsWith("/reel/")) return;
      const video = watchVideoRef.current;
      const fd = fileDataRef.current;
      if (!video || !fd || !isHLSRef.current) return;
      // Paused/ended → fall through to natural unmount; HLS is destroyed in useHLS cleanup.
      if (video.paused || video.ended) return;
      activateMiniPlayer({
        src: resolvePlaybackSrc(fd, { mintedUrl: playbackUrlRef.current }),
        file: { ...fd, owner: fd.owner ?? ownerRef.current ?? null },
        imageID: fd.unique_id,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only on true unmount of this screen
  }, [activateMiniPlayer, closeMiniPlayer]);

  useEffect(() => {
    if (isHLS || hasIncrementedView || !file_data?.id) return;
    const t = setTimeout(runViewIncrement, requiredViewSeconds * 1000);
    return () => clearTimeout(t);
  }, [isHLS, file_data?.id, hasIncrementedView, runViewIncrement, requiredViewSeconds]);

  const videoBlock = (
    <motion.div layoutId={`video_id_${file_data.unique_id}`}
    transition={
      animateTheater
        ? { duration: 0.3, ease: [0.4, 0, 0.2, 1] }
        : { duration: 0 }
    }
    className={`
      relative z-10 w-full overflow-hidden
      ${isStandalone ? "pt-8" : ""}
      ${theaterMode ? (playerBackground ? "bg-black" : "bg-transparent") : "rounded-lg"}
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
        className={cn("relative mx-auto", isHLS && `player_inner_${file_data.unique_id}`)}
        style={{
          // Match the video's aspect (clamped above); cap the height so portrait
          // clips stay within the viewport and width shrinks instead of the
          // frame towering. Width fills the column for normal ~16:9 videos.
          aspectRatio: String(playerFrameAspect),
          width: `min(100%, calc(${theaterMode ? 90 : 82}vh * ${playerFrameAspect}))`,
        }}
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
          <ImageWatchCarousel
            seed={file_data}
            onColors={imageLoadCallBack}
            onActiveChange={handleCarouselActive}
          />
        )}
      </div>
    </motion.div>
  );

  const description = file_data.file_description?.trim() ?? "";
  // Hover tint for the collapsed description card: the FILE's dominant
  // color crushed onto the theme surface (YouTube's trick). color-mix keeps
  // most of the surface's luminance, so the hue shows but text contrast
  // survives in both light and dark themes.
  const descriptionTint = useMemo(
    () =>
      fileHoverTint(
        (file_data as { colors?: unknown }).colors,
        String(file_data.unique_id ?? file_data.id ?? ""),
      ),
    [file_data],
  );
  const descRef = useRef<HTMLDivElement>(null);
  // After collapsing, snap the card back into view if its top scrolled past the viewport.
  const descCardRef = useRef<HTMLDivElement>(null);
  const descJustCollapsedRef = useRef(false);
  const collapseDescription = useCallback(() => {
    descJustCollapsedRef.current = true;
    setDescriptionExpanded(false);
  }, []);
  useLayoutEffect(() => {
    if (descriptionExpanded || !descJustCollapsedRef.current) return;
    descJustCollapsedRef.current = false;
    const el = descCardRef.current;
    if (!el) return;
    if (el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
    }
  }, [descriptionExpanded]);
  const [isOverflowing, setIsOverflowing] = useState(false);
  useEffect(() => {
    const el = descRef.current;
    if (!el) {
      setIsOverflowing(false);
      return;
    }
    // +1 avoids sub-pixel rounding false positives.
    const check = () => setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [description, descriptionExpanded]);

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
  // VideoObject is what makes a video eligible for a search preview; CreativeWork
  // is not. Falls back to the old shape when the file has no public preview.
  const videoLd = isVideo
    ? buildVideoObject({
        file: file_data as never,
        name: ldTitle,
        description: ldDescription,
        pageUrl: pageUrlForLd,
        thumbnailUrl: jsonLdThumbnail,
        uploadDate: file_data?.created_at ? new Date(file_data.created_at).toISOString() : null,
        authorName: ownerName,
      })
    : null;

  const jsonLd = isVideo
    ? videoLd ?? {
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
    <div className="relative w-full space-y-4 max-lg:overflow-visible max-lg:rounded-none max-lg:px-2 max-lg:py-0 lg:overflow-hidden lg:rounded-lg lg:p-4">
      <h1 className="text-xl font-bold text-foreground leading-tight select-text">
        <ParseFilenameInsert filename={ParseFilename(file_data.file_title || file_data.filename || "")}/>
      </h1>

      {/* Wraps rather than squeezing: when the actions no longer fit beside the
          channel, they drop to their own full-width line instead of truncating
          the channel name to make room. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-4 lg:gap-y-3">
        {data.owner && (
          <div className="flex items-center justify-between gap-3 lg:min-w-0 lg:flex-1 lg:basis-80">
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
                contextFileId={data.file?.id ?? null}
                currentUserId={userId}
                initialSubscribed={data.channelStats.is_subscribed}
                initialNotify={data.channelStats.notify}
                initialCount={data.channelStats.subscriber_count}
                isOwner={isOwner}
              />
            )}
          </div>
        )}

        <div className="min-w-0 max-lg:w-full lg:max-w-full lg:shrink-0">
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
        onCommentCountDelta={handleCommentCountDelta}
      />
        </div>
      </div>

      {/* YouTube-style description card. Collapsed: stats + a couple of
          description lines + inline "...more"  EVERYTHING else (hashtags,
          Music, remix row) stays folded. No description? Everything folds
          and "...more" sits inline on the stats row. Categories stay in the
          data for SEO/meta + the feed  never rendered to viewers. */}
      <div
        ref={descCardRef}
        className={cn(
          "rounded-xl bg-muted/40 px-3 py-3 max-lg:rounded-lg scroll-mt-20",
          !descriptionExpanded &&
            (descriptionTint
              ? "cursor-pointer transition-colors duration-300 hover:bg-[var(--desc-tint)]"
              : "cursor-pointer transition-colors hover:bg-muted/55"),
        )}
        style={
          !descriptionExpanded && descriptionTint
            ? ({ "--desc-tint": descriptionTint } as React.CSSProperties)
            : undefined
        }
        onClick={!descriptionExpanded ? () => setDescriptionExpanded(true) : undefined}
      >
        {/* Collapsed: compact stats (10k views, 2 days ago). Expanded: exact values (10,000 views, 2025-05-07 at 4:32 PM). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
          <span className="font-semibold tabular-nums">
            {descriptionExpanded ? views.toLocaleString("en-US") : formatNumber(views)} views
          </span>
          {file_data.created_at && (
            <span className="font-semibold">
              {descriptionExpanded
                ? formatExactDate(file_data.created_at)
                : formatTimeAgo(file_data.created_at)}
            </span>
          )}
          {/* No description text: the expand affordance lives inline here. */}
          {!descriptionExpanded &&
            !description &&
            (tagsList.length > 0 ||
              !!resolvedPageDetails?.acoustidRecording ||
              !!resolvedPageDetails?.originalSound ||
              (resolvedPageDetails?.soundRemixes?.length ?? 0) > 0) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDescriptionExpanded(true);
                }}
                className="text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                ...more
              </button>
            )}
        </div>
        {description && (
          <div className="mt-2">
            <div
              ref={descRef}
              className={cn(
                "text-sm text-foreground break-words whitespace-pre-wrap",
                !descriptionExpanded && "line-clamp-2",
              )}
            >
              <FormattedText
                text={description}
                timestamps={
                  typeof file_data.duration === "number" && file_data.duration > 0
                    ? { maxSeconds: file_data.duration, fileId: file_data.id }
                    : undefined
                }
              />
            </div>
            {!descriptionExpanded &&
              (isOverflowing ||
                tagsList.length > 0 ||
                !!resolvedPageDetails?.acoustidRecording ||
                !!resolvedPageDetails?.originalSound ||
                (resolvedPageDetails?.soundRemixes?.length ?? 0) > 0) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDescriptionExpanded(true);
                  }}
                  className="mt-1 text-sm font-semibold text-foreground hover:underline"
                >
                  ...more
                </button>
              )}
          </div>
        )}

        {/* Hashtags  YouTube-style blue #tags under the description. */}
        {descriptionExpanded && tagsList.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
            {tagsList.map((t) => (
              <Link
                key={t}
                to={`/tag/${encodeURIComponent(t)}`}
                className="text-sm text-primary hover:underline underline-offset-2"
              >
                #{t.replace(/\s+/g, "")}
              </Link>
            ))}
          </div>
        )}

        {/* AcoustID match + cover — always visible (not buried under ...more). */}
        {resolvedPageDetails?.acoustidRecording && (
          <AcoustidRecordingCard
            recording={resolvedPageDetails.acoustidRecording}
            host={{
              unique_id: String(file_data.unique_id),
              created_at: file_data.created_at ?? null,
            }}
          />
        )}

        {/* Audio matched an existing upload  YouTube-style "Music" attribution. */}
        {descriptionExpanded &&
          !resolvedPageDetails?.acoustidRecording &&
          resolvedPageDetails?.originalSound && (
          <OriginalSoundCard originalSound={resolvedPageDetails.originalSound} />
        )}

        {/* This file IS the original: the videos that sampled its sound. */}
        {descriptionExpanded && (resolvedPageDetails?.soundRemixes?.length ?? 0) > 0 && (
          <div className="mt-4 border-t border-border/60 pt-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold text-foreground">Videos using this sound</h3>
                <p className="text-xs text-muted-foreground">
                  {resolvedPageDetails!.soundRemixes.length}
                  {resolvedPageDetails!.soundRemixes.length >= 12 ? "+" : ""} videos
                </p>
              </div>
              <Link
                to={`/music/${encodeURIComponent(String(file_data.id))}`}
                className="shrink-0 text-sm font-medium text-primary hover:underline"
              >
                See all
              </Link>
            </div>
            <Carousel label="Videos using this sound" itemWidth={144} gapClassName="gap-2">
              {resolvedPageDetails!.soundRemixes.map((remix, index) => (
                <CarouselItem key={remix.unique_id}>
                  <VideoCard
                    data={soundRemixToFileType(remix)}
                    layout="reelStrip"
                    related
                    index={index}
                    currentUserId={userId || undefined}
                    userActions={mergedSidebarUserActions}
                    hideActions={{ completely: true }}
                  />
                </CarouselItem>
              ))}
            </Carousel>
          </div>
        )}

        {/* Fold everything back up. */}
        {descriptionExpanded && (
          <button
            type="button"
            onClick={collapseDescription}
            className="mt-4 text-sm font-semibold text-foreground hover:underline"
          >
            Show less
          </button>
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
            fileUniqueId={file_data.unique_id}
            fileCreatedAt={file_data.created_at}
            fileIsAdult={file_data.is_adult}
            currentUserId={userId || undefined}
            fileOwnerId={file_data.owner_id || undefined}
            commentsEnabled={file_data.comments_enabled !== false}
            highlightCommentId={highlightCommentId}
            fileDurationSec={typeof file_data.duration === "number" ? file_data.duration : undefined}
            onCountDelta={handleCommentCountDelta}
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
    <aside className={`${!theaterMode ? "min_size_checker" : "min-w-0"}`}>
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
    <WatchModalShell variant="page">
      <WatchPlayBootstrapSync
        currentUniqueId={file_data.unique_id}
        fileId={file_data.id}
        viewerCanCustomizeQueue={Boolean(userId)}
        currentIsImage={typeof file_data.file_type === "string" && file_data.file_type.startsWith("image/")}
        seriesUpNextVideos={seriesUpNextVideos}
        suggestedVideos={autoNextVideos}
        userActions={data.relatedVideosUserActions}
      />
    <div className="relative  min-h-screen reel_p" key={`dynamic-${currentId}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // Escape sequences that could break out of the <script> tag (user input flows through this).
          __html: JSON.stringify(jsonLd)
            .replace(/</g, "\\u003c")
            .replace(/>/g, "\\u003e")
            .replace(/&/g, "\\u0026")
            .replace(new RegExp("\\u2028", "g"), "\\u2028")
            .replace(new RegExp("\\u2029", "g"), "\\u2029"),
        }}
      />
      <div className="relative z-10 mx-auto max-w-full flex flex-col justify-center">
        {/* 
          never remove this comment
          This is the original grid layout for the watch page I may change it later but for now keep it here.
          <div className={!theaterMode ? "grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3 lg:gap-6 xl:gap-8" : ""}>
          <div className={!theaterMode ? "min-w-0 space-y-3 sm:space-y-4 lg:col-span-2" : ""}>
        */}
        <div className={!theaterMode ? "watch-flex flex gap-4 flex justify-center" : ""}>
          <div 
          style={{
            aspectRatio: String(playerFrameAspect),
            width: `min(100%, calc(${theaterMode ? 90 : 82}vh * ${playerFrameAspect}))`,
          }}
           className={!theaterMode ? "min-w-0 w-fit space-y-3 sm:space-y-4 lg:col-span-2 xl:col-span-1" : "mx-auto"}>
            <div 
              style={{
                // Match the video's aspect (clamped above); cap the height so portrait
                // clips stay within the viewport and width shrinks instead of the
                // frame towering. Width fills the column for normal ~16:9 videos.
                aspectRatio: String(playerFrameAspect),
                width: `min(100%, calc(${theaterMode ? 90 : 82}vh * ${playerFrameAspect}))`,
              }}
             className="relative w-fit overflow-visible">
              {videoBlock}
              {ambientEnabled && (
                <div
                  className="ambience-wrap pointer-events-none absolute -z-10"
                  aria-hidden
                  style={{
                    inset: (() => {
                      const box = 16 / 9;
                      const hm = 10 + 70 * (ambientSizeMul - 1);
                      const vm = 14 + 106 * (ambientSizeMul - 1);
                      let h = -hm;
                      let v = -vm;
                      if (!playerBackground && ambienceVideoAspect) {
                        if (ambienceVideoAspect < box) {
                          const frac = ambienceVideoAspect / box;
                          h = ((1 - frac) / 2) * 100 - hm * frac;
                        } else if (ambienceVideoAspect > box) {
                          const frac = box / ambienceVideoAspect;
                          v = ((1 - frac) / 2) * 100 - vm * frac;
                        }
                      }
                      return `${v}% ${h}%`;
                    })(),
                    overflow: "visible",
                  }}
                >
                  {isSidebarMobile && (
                    <div className="mobile_blur_overlay absolute inset-x-0 bottom-0 h-full z-[10] bg-gradient-to-t from-background/95 via-background/60 to-transparent" />
                  )}
                  {/*
                    Rectangular ambient falloff (YouTube style): two crossed linear
                    fades on nested layers multiply into a soft-edged RECTANGLE that
                    follows the video's shape - full strength behind the picture,
                    feathering out toward the wrap edges. The old elliptical radial
                    mask read as a round blob that ignored the video's corners.
                  */}
                  <div
                    className="absolute inset-0 opacity-80"
                    style={{
                      WebkitMaskImage:
                        "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 14%, black 30%, black 70%, rgba(0,0,0,0.55) 86%, transparent 100%)",
                      maskImage:
                        "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 14%, black 30%, black 70%, rgba(0,0,0,0.55) 86%, transparent 100%)",
                    }}
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        WebkitMaskImage:
                          "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.55) 12%, black 26%, black 74%, rgba(0,0,0,0.55) 88%, transparent 100%)",
                        maskImage:
                          "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.55) 12%, black 26%, black 74%, rgba(0,0,0,0.55) 88%, transparent 100%)",
                      }}
                    >
                      <Ambience colors={imageColors || []} videoRef={watchVideoRef} videoReady={videoRefReady} sync={ambientSyncOn} />
                    </div>
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
    </WatchModalShell>
  );
}
export default DynamicPage