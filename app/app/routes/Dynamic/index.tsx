import { data, Link, useLoaderData, useNavigate, useParams, useNavigation, useLocation, type MetaFunction } from "react-router";
import db from "~/lib/Database/supabase";
import HLSPlayer from "~/components/components/hlsplayer";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import RelatedVideos from "./components/RelatedVideos";
import type { FileType } from "~/lib/types";
import { BASE_URL } from "~/lib/URLS";
import { buildPageMeta } from "~/lib/seo";
import ImageLoad from "../Home/components/ImageLoad/ImageLoad";
import { arrangeDateForThumbnail, ParseFilename, getRandomThumbnail, getVideoSrc } from "~/lib/utils";
import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
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
import { commentService } from "~/lib/Services/CommentService";
import DownloadButton from "./components/DownloadButton";
import { formatNumber } from "~/lib/utils/formatNumber";
import { useWatchTracking } from "~/lib/hooks/useWatchTracking";
import { IMAGE_BASE_URL } from "~/lib/URLS";
import ParseFilenameInsert from "~/lib/utils/ShowFileName";
import { usePageCache } from "~/lib/hooks/usePageCache";
import CanvasGradient from "~/components/accessories/CanvasGradient/CanvasGradient";
import Ambience from "~/components/accessories/CanvasGradient/Ambience";

interface DynamicCachePayload {
  file: any;
  id: string;
  relatedVideos: FileType[];
  userLiked: boolean;
  userDisliked: boolean;
  likeCount: number;
  dislikeCount: number;
  userId: string | null;
  owner: { id: string; username: string; profile_pic: string } | null;
  commentsCount: number;
  relatedVideosUserActions: { likedFileIds: string[]; dislikedFileIds: string[] };
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
      return data({ file: null, id: params.id, relatedVideos: [], userLiked: false, userDisliked: false, likeCount: 0, dislikeCount: 0, userId: null, accessDenied: false as const, reason: undefined }, { status: 404 });
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
        reason: accessControl.reason
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
        thumbnails: row.thumbnails || [],
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
    if (file.owner_id) {
      const { data: ownerData } = await db
        .from('users')
        .select('id, username, profile_pic')
        .eq('id', file.owner_id)
        .maybeSingle();
      
      if (ownerData) {
        owner = {
          id: ownerData.id,
          username: ownerData.username,
          profile_pic: ownerData.profile_pic
        };
      }
    }

    let commentsCount = 0;
    if (file.id) {
      const commentsCountResult = await commentService.getCommentsCount(file.id);
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
      commentsCount,
      relatedVideosUserActions: {
        likedFileIds: Array.from(relatedVideosUserActions.likedFileIds),
        dislikedFileIds: Array.from(relatedVideosUserActions.dislikedFileIds)
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

    let thumbnail = (() => {
      if (file?.file_type?.startsWith("image/") && file?.endpoint) return `/api/load/image/${file.endpoint}`;
      const randomThumbnail = getRandomThumbnail(file?.thumbnails);
      if (randomThumbnail) return `/api/load/image/${randomThumbnail}`;
      const isHLS =
        file?.file_type === "application/vnd.apple.mpegurl" || file?.endpoint?.includes(".m3u8");
      if (isHLS)
        return `/api/load/image/${arrangeDateForThumbnail(file?.created_at)}/${file?.unique_id}/thumbnail_${ParseFilename(file?.filename)}.jpg`;
      return `/api/load/image/${file?.endpoint}`;
    })();
    thumbnail = `${thumbnail}?quality=50`;

    const ogType = isImage ? "image" : "website";
    const thumbnailUrl = `${BASE_URL}${thumbnail}`;

    const extra: import("react-router").MetaDescriptor[] = [
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:image:secure_url", content: thumbnailUrl },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
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
      ogImage: thumbnail,
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
    commentsCount: fresh.commentsCount,
    relatedVideosUserActions: { likedFileIds: mergedLiked, dislikedFileIds: mergedDisliked },
  };
}

const index = () => {
  const params = useParams();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const currentId = params.id;
  const pathname = location.pathname;
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
        commentsCount: ('commentsCount' in loaderData ? loaderData.commentsCount : 0) as number,
        relatedVideosUserActions: ('relatedVideosUserActions' in loaderData ? loaderData.relatedVideosUserActions : { likedFileIds: [], dislikedFileIds: [] }) as any,
      };
      return blendDynamicData(cachedData, freshPayload);
    }

    if (cacheValid && cachedData) return cachedData;

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
        commentsCount: ('commentsCount' in loaderData ? loaderData.commentsCount : 0) as number,
        relatedVideosUserActions: ('relatedVideosUserActions' in loaderData ? loaderData.relatedVideosUserActions : { likedFileIds: [], dislikedFileIds: [] }) as any,
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

  const [views, setViews] = useState<number>(Number(file_data?.views || file_data?.view_count || 0));
  const [shares, setShares] = useState<number>(Number(file_data?.shares || file_data?.share_count || 0));
  const [hasIncrementedView, setHasIncrementedView] = useState(false);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [videoRefReady, setVideoRefReady] = useState(false);

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
  const userId = data.userId || null;

  useWatchTracking({
    fileId: file_data?.id || '',
    userId: userId,
    isVideo: isVideo,
    videoElement: videoElementRef.current,
    source: 'page_view',
  });

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
  const [theaterMode, setTheaterModeState] = useState(() => {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem('player-theater-mode') === 'true';
    } catch { return false; }
  })
  const setTheaterMode = (v: boolean) => {
    setTheaterModeState(v);
    try { localStorage.setItem('player-theater-mode', v ? 'true' : 'false'); } catch {}
  }
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
  const isOwner = Boolean(data.userId && file_data?.owner_id && data.userId === file_data.owner_id);

  const retry = () => {
    if(retryAttempt >= 1) return;
    setRetryAttempt(retryAttempt + 1);
  }

  const relatedVideos = data.relatedVideos ?? [];
  const suggestedVideos = relatedVideos.filter((v: FileType) => v.unique_id !== currentId).slice(0, 8);

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

  useEffect(() => {
    if (isHLS || hasIncrementedView || !file_data?.id) return;
    const t = setTimeout(runViewIncrement, requiredViewSeconds * 1000);
    return () => clearTimeout(t);
  }, [isHLS, file_data?.id, hasIncrementedView, runViewIncrement, requiredViewSeconds]);

  const videoBlock = (
    <motion.div layoutId={`video_id_${file_data.unique_id}`} className={`relative z-10 w-full overflow-hidden rounded-lg ${isStandalone ? "pt-8" : ""}`} key={`motion-${file_data.unique_id}-${currentId}`}>
      {file_data?.is_adult && (
        <AdultContentBadge isPlaying={playingVideos.has(1)} className="top-3 left-3" />
      )}
      <CanvasGradient className={`${isStandalone ? "mt-8" : ""}`} colors={imageColors || []} />
      <div className={`${isHLS ? `aspect-video rounded-lg overflow-hidden w-full ` : 'w-full flex items-center justify-center overflow-hidden rounded-lg'} relative`}>
        {isHLS ? (
          <HLSPlayer
            videoRef={videoElementRef as React.RefObject<HTMLVideoElement>}
            src={getVideoSrc(file_data?.endpoint ?? '', file_data?.file_type)}
            className="w-full h-full"
            onPlay={() => {
              setPlayingVideos(prev => new Set(prev).add(1));
              onVideoPlayForView();
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
            file={file_data}
            key={`hls-${file_data.unique_id}-${currentId}`}
            onVideoRef={(ref) => {
              setVideoRefReady(!!ref);
            }}
            callBack={e => {
              setImageColors(e.colors)
              setMadeImageUrl(e.src)
            }}
            theaterMode={isMobile ? false : theaterMode}
            onTheaterModeChange={isMobile ? undefined : setTheaterMode}
            suggestedVideos={suggestedVideos}
            onVideoSelect={(video) => navigate(`/${video.unique_id}`)}
            onAmbientModeChange={setAmbientEnabled}
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
              hasAdultTag={false}
              callBack={e => {
                setMadeImageUrl(e.src)
                setImageColors(e.colors)
              }}
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

  const jsonLdThumbnail = (() => {
    if (file_data?.file_type?.startsWith("image/") && file_data?.endpoint)
      return `${BASE_URL}/api/load/image/${file_data.endpoint}?quality=50`;
    const randomThumb = getRandomThumbnail(file_data?.thumbnails);
    if (randomThumb) return `${BASE_URL}/api/load/image/${randomThumb}?quality=50`;
    if (isHLS && file_data?.created_at && file_data?.unique_id && file_data?.filename)
      return `${BASE_URL}/api/load/image/${arrangeDateForThumbnail(file_data.created_at)}/${file_data.unique_id}/thumbnail_${ParseFilename(file_data.filename)}.jpg?quality=50`;
    return file_data?.endpoint ? `${BASE_URL}/api/load/image/${file_data.endpoint}?quality=50` : "";
  })();
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
    <div className="space-y-4 z-[10000]">
      <h1 className="text-xl font-bold text-foreground leading-tight select-text z-[10000]">
        <ParseFilenameInsert filename={file_data.file_title || file_data.filename}/>  
      </h1>

      {data.owner && (
        <OwnerProfile owner={data.owner} size="md" showUsername />
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
        onUpdate={data.userId ? handleInteractionUpdate : undefined}
      />

      <div className="rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground px-4 pt-3 pb-1">
          <span className="font-medium text-foreground">{formatNumber(views)} views</span>
          <span>{new Date(file_data.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          {shares > 0 && (
            <>
              <span aria-hidden>•</span>
              <span>{formatNumber(shares)} shares</span>
            </>
          )}
        </div>
        {(description || hasLongDescription) && (
          <div className="px-4 pt-1">
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
          <div className="px-4 pb-3 pt-2 space-y-2">
            {categoriesList.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground mr-1">Categories</span>
                {categoriesList.map((c) => (
                  <Link
                    key={c}
                    to={`/tag/${encodeURIComponent(c)}`}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                  >
                    {c}
                  </Link>
                ))}
              </div>
            )}
            {tagsList.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground mr-1">Tags</span>
                {tagsList.map((t) => (
                  <Link
                    key={t}
                    to={`/tag/${encodeURIComponent(t)}`}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    {t}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <CommentSection
        key={`comments-${file_data.id}-${currentId}`}
        fileId={file_data.id}
        currentUserId={data.userId || undefined}
      />
    </div>
  );

  const relatedColumn = (
    <div className="lg:col-span-1">
      <div className="sticky top-6">
        <RelatedVideos 
          key={`related-${file_data.unique_id}-${currentId}`}
          videos={relatedVideos} 
          currentVideoId={file_data.unique_id}
          currentVideoDbId={file_data.id}
          ownerId={file_data.owner_id}
          currentUserId={data.userId || undefined}
          currentFileType={file_data.file_type}
          userActions={data.relatedVideosUserActions ? {
            likedFileIds: new Set(data.relatedVideosUserActions.likedFileIds || []),
            dislikedFileIds: new Set(data.relatedVideosUserActions.dislikedFileIds || [])
          } : undefined}
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
      <div className={`relative z-10 mx-auto max-w-full xl:container py-8`}>
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
              <div className="mx-auto max-w-full xl:container py-6 px-4 z-[100000]">
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