import { data, Link, useLoaderData, useNavigate, useParams, useNavigation, type MetaFunction } from "react-router";
import db from "~/lib/Database/supabase";
import HLSPlayer from "~/components/components/hlsplayer";
import { useEffect, useState, useRef } from "react";
import RelatedVideos from "./components/RelatedVideos";
import type { FileType } from "~/lib/types";
import { BASE_URL } from "~/lib/URLS";
import ImageLoad from "../Home/components/ImageLoad/ImageLoad";
import { arrangeDateForThumbnail, ParseFilename, getRandomThumbnail, getVideoSrc } from "~/lib/utils";
import { motion } from "framer-motion";
import { MakeVideoToken } from "./components/Functions";
import { ShieldAlert } from "lucide-react";
import { useSidebar } from "~/components/ui/sidebar";
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

    let videoToken = await MakeVideoToken(file?.file_type, params.id, request.headers)
    const path = new URL(request.url).pathname;
    let headers = new Headers();
    
    if(videoToken) {
      let vid_path = `/api/load/video/${file.endpoint.split(`${path}`)[0]}${path}`
      headers.append('Set-Cookie', `videoToken=${videoToken}; Path=${vid_path}; Max-Age=86400; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure' : ''}; SameSite=Strict, priority=high`);
      headers.append('Set-Cookie', `validator=${videoToken}; Path=/; Max-Age=86400; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure' : ''}; SameSite=Strict, priority=high`);
    }

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

    // Fetch owner profile
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

    // Fetch comments count
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

export const meta: MetaFunction<ReturnType<typeof loader>> = ({ data }: {data: any}) => {
  try {
    if(!data || !data?.file) {
      const title = data?.accessDenied ? 'Access Denied - Memories' : 'Not Found - Memories';
      const description = data?.accessDenied ? 'You do not have permission to view this content.' : 'File not found';
      return [
        {
          title,
          description,
        }
      ];
    }

    const file = data?.file;
    const displayTitle = (file?.file_title && file.file_title.trim() !== '') 
      ? file.file_title 
      : ParseFilename(file?.filename || '');
    
    // Get likes, comments, views, and shares count
    const likesCount = Number(file?.up_count) || 0;
    const commentsCount = data?.commentsCount || 0;
    const viewsCount = Number(file?.views || file?.view_count || 0);
    const sharesCount = Number(file?.shares || file?.share_count || 0);
    
    // Build description with stats
    const statsParts = [];
    if (viewsCount > 0) statsParts.push(`${formatNumber(viewsCount)} views`);
    if (likesCount > 0) statsParts.push(`${likesCount} ${likesCount === 1 ? 'like' : 'likes'}`);
    if (sharesCount > 0) statsParts.push(`${formatNumber(sharesCount)} shares`);
    if (commentsCount > 0) statsParts.push(`${commentsCount} ${commentsCount === 1 ? 'comment' : 'comments'}`);
    const statsText = statsParts.join(' • ');
    
    const displayDescription = (file?.file_description && file.file_description.trim() !== '')
      ? `${file.file_description} | ${statsText}`
      : `${ParseFilename(file?.filename || '')} | ${statsText} | ${file?.file_type} | ${file?.file_size}`;

    let thumbnail = (() => {
      if (file?.file_type?.startsWith('image/') && file?.endpoint) {
        return `/api/load/image/${file.endpoint}`;
      }
      const randomThumbnail = getRandomThumbnail(file?.thumbnails);
      if (randomThumbnail) {
        return `/api/load/image/${randomThumbnail}`;
      }
      const isHLS = file?.file_type === 'application/vnd.apple.mpegurl' || file?.endpoint?.includes('.m3u8');
      if (isHLS) {
        return `/api/load/image/${arrangeDateForThumbnail(file?.created_at)}/${file?.unique_id}/thumbnail_${ParseFilename(file?.filename)}.jpg`;
      }
      return `/api/load/image/${file?.endpoint}`;
    })();
    thumbnail = `${thumbnail}?quality=50`

    const isVideo = file?.file_type?.includes('video') || file?.file_type === 'application/vnd.apple.mpegurl' || file?.endpoint?.includes('.m3u8');
    const isImage = file?.file_type?.startsWith('image/');
    const ogType = isVideo ? 'video.other' : isImage ? 'image' : 'website';
    const twitterCard = isVideo ? 'player' : 'summary_large_image';
    const pageUrl = `${BASE_URL}/${data?.id}`;
    const thumbnailUrl = `${BASE_URL}${thumbnail}`;

    return [
      {
        title: `${displayTitle} - Memories`,
      },
      {
        name: 'description',
        content: `${displayDescription} - Memories`
      },
      { name: "keywords", content: `${file?.file_type || ''}, ${isVideo ? 'video' : isImage ? 'image' : 'media'}, memories, share` },
      { name: "author", content: data?.owner?.username || 'Memories' },
      { name: "canonical", content: pageUrl },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: ogType },
      { property: "og:title", content: `${displayTitle} - Memories` },
      { property: "og:description", content: `${displayDescription} - Memories` },
      { property: "og:image", content: thumbnailUrl },
      { property: "og:image:alt", content: displayTitle },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:url", content: pageUrl },
      { property: "og:site_name", content: "Memories" },
      { property: "og:locale", content: "en_US" },
      ...(isVideo ? [
        { property: "og:video:type", content: file?.file_type || "video/mp4" },
        { property: "og:video:url", content: `${BASE_URL}${getVideoSrc(file?.endpoint ?? '', file?.file_type)}` },
      ] : []),
      ...(data?.owner ? [
        { property: "article:author", content: data.owner.username },
      ] : []),
      ...(file?.created_at ? [
        { property: "article:published_time", content: new Date(file.created_at).toISOString() },
      ] : []),
      { name: "twitter:card", content: twitterCard },
      { name: "twitter:title", content: `${displayTitle} - Memories` },
      { name: "twitter:description", content: `${displayDescription} - Memories` },
      { name: "twitter:image", content: thumbnailUrl },
      { name: "twitter:image:alt", content: displayTitle },
      { rel: "preconnect", href: thumbnailUrl, as: "image" },
      { rel: "dns-prefetch", href: BASE_URL },
    ]
  }
  catch (error) {
    console.error('Error in meta:', error);
    return [
      {
        title: 'Error',
        description: 'Error loading file',
      }
    ];
  }
}
const index = () => {
  const params = useParams();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const currentId = params.id;
  
  const [playingVideos, setPlayingVideos] = useState<Set<number>>(new Set());
  const data = useLoaderData<typeof loader>();
  const file_data = data?.file;
  const [views, setViews] = useState<number>(Number(file_data?.views || file_data?.view_count || 0));
  const [shares, setShares] = useState<number>(Number(file_data?.shares || file_data?.share_count || 0));
  const [hasIncrementedView, setHasIncrementedView] = useState(false);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  
  // Track previous ID to detect route changes
  const prevIdRef = useRef<string | undefined>(currentId);
  
  // Reset all state when route ID changes
  useEffect(() => {
    if (prevIdRef.current && prevIdRef.current !== currentId) {
      // Route changed - reset all state
      setPlayingVideos(new Set());
      setHasIncrementedView(false);
      setRetryAttempt(0);
      setImageUrl(null);
      setImageColors(null);
      setMadeImageUrl(null);
      videoElementRef.current = null;
      
      // Scroll to top on route change
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevIdRef.current = currentId;
  }, [currentId]);
  
  // Update views and shares when new file data loads
  useEffect(() => {
    if (file_data) {
      const newViews = Number(file_data.views || file_data.view_count || 0);
      const newShares = Number(file_data.shares || file_data.share_count || 0);
      
      setViews(newViews);
      setShares(newShares);
    }
  }, [file_data?.id, file_data?.views, file_data?.view_count, file_data?.shares, file_data?.share_count]);

  if (data?.accessDenied) {
    const getAccessDeniedMessage = () => {
      switch (data.reason) {
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
  
  if(!file_data) {
    return (
      <>
        <div className={`flex items-center justify-center text-2xl py-6 px-4 min-h-[200px]`}>
          <h1>File not found</h1>
        </div>
      </>
    )
  }

  const isHLS = file_data?.file_type === 'application/vnd.apple.mpegurl' || file_data?.endpoint?.includes('.m3u8');
  const isVideo = isHLS || file_data?.file_type?.includes('video');
  const userId = ('userId' in data && data.userId) || null;

  // Track watch time and watch percentage
  // Only track if we have a valid file ID and it matches the current route
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
  const [liked, setLiked] = useState(('userLiked' in data && data.userLiked) || false)
  const [disliked, setDisliked] = useState(('userDisliked' in data && data.userDisliked) || false)
  const [likeCount, setLikeCount] = useState(Number(data?.likeCount) || 0)
  const [dislikeCount, setDislikeCount] = useState(Number(data?.dislikeCount) || 0)
  const {isMobile, state} = useSidebar();

  useEffect(() => {
    if (!file_data) return
    setLiked(('userLiked' in data && data.userLiked) || false)
    setDisliked(('userDisliked' in data && data.userDisliked) || false)
    setLikeCount(Number(data?.likeCount) || 0)
    setDislikeCount(Number(data?.dislikeCount) || 0)
  }, [currentId, file_data?.id])

  const handleInteractionUpdate = (updates: { liked: boolean; disliked: boolean; like_count: number; dislike_count: number }) => {
    setLiked(updates.liked)
    setDisliked(updates.disliked)
    setLikeCount(updates.like_count)
    setDislikeCount(updates.dislike_count)
  }

  const commentsCount = ('commentsCount' in data ? data.commentsCount : 0) || 0
  const isOwner = Boolean(('userId' in data && data.userId) && file_data?.owner_id && ('userId' in data && data.userId) === file_data.owner_id)

  const retry = () => {
    if(retryAttempt >= 1) {
      return
    }
    setRetryAttempt(retryAttempt + 1)
  }

  const relatedVideos = (data && 'relatedVideos' in data) ? data.relatedVideos : [];
  const suggestedVideos = relatedVideos.filter((v: FileType) => v.unique_id !== currentId).slice(0, 8);

  // Show loading state during navigation
  const isNavigating = navigation.state === 'loading' && navigation.location?.pathname !== window.location.pathname;

  // Increment views when component mounts or when file ID changes
  useEffect(() => {
    if (!file_data?.id || hasIncrementedView || !file_data?.unique_id) return;
    
    // Reset increment flag if file ID changed
    if (prevIdRef.current !== currentId) {
      setHasIncrementedView(false);
    }

    const incrementViews = async () => {
      try {
        const response = await fetch('/api/views/increment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileId: file_data.id,
            uniqueId: file_data.unique_id,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            setViews(result.views || result.view_count || views + 1);
            setHasIncrementedView(true);
          }
        }
      } catch (error) {
        console.error('Error incrementing views:', error);
        // Silently fail - don't show error to user
      }
    };

    incrementViews();
  }, [file_data?.id, file_data?.unique_id, currentId, hasIncrementedView, views]);

  const videoBlock = (
    <motion.div layoutId={`video_id_${file_data.unique_id}`} className="relative w-full" key={`motion-${file_data.unique_id}-${currentId}`}>
      {file_data?.is_adult && (
        <AdultContentBadge isPlaying={playingVideos.has(1)} className="top-3 left-3" />
      )}
      <div className={`${isHLS ? 'aspect-video bg-black rounded-lg overflow-hidden w-full' : 'w-full flex items-center justify-center overflow-hidden rounded-lg bg-black'} relative`}>
        {isHLS ? (
          <HLSPlayer
            src={getVideoSrc(file_data?.endpoint ?? '', file_data?.file_type)}
            className="w-full h-full"
            onPlay={() => setPlayingVideos(prev => new Set(prev).add(1))}
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
              videoElementRef.current = ref;
            }}
            callBack={e => {
              setImageColors(e.colors)
              setMadeImageUrl(e.src)
            }}
            theaterMode={isMobile ? false : theaterMode}
            onTheaterModeChange={isMobile ? undefined : setTheaterMode}
            suggestedVideos={suggestedVideos}
            onVideoSelect={(video) => navigate(`/${video.unique_id}`)}
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

  const contentColumn = (
            <div className="space-y-4">
              {/* Title */}
              <h1 className="text-xl font-bold text-foreground leading-tight select-text">
                <ParseFilenameInsert filename={file_data.file_title || file_data.filename}/>  
              </h1>

              {/* Channel row: avatar + name only */}
              {('owner' in data && data.owner) && (
                <OwnerProfile owner={data.owner} size="md" showUsername />
              )}

              {/* Same Actions as VideoCard: Like, Dislike, Comments, Options */}
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
                onUpdate={('userId' in data && data.userId) ? handleInteractionUpdate : undefined}
              />

              {/* Description box: views, then description, then categories & tags */}
              <div className="rounded-xl bg-zinc-900/80 overflow-hidden">
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
                    <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                      {descriptionToShow}
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
                    </p>
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
                currentUserId={('userId' in data && data.userId) || undefined}
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
                currentUserId={('userId' in data && data.userId) || undefined}
                currentFileType={file_data.file_type}
                userActions={('relatedVideosUserActions' in data && data.relatedVideosUserActions) ? {
                  likedFileIds: new Set(data.relatedVideosUserActions.likedFileIds || []),
                  dislikedFileIds: new Set(data.relatedVideosUserActions.dislikedFileIds || [])
                } : undefined}
              />
            </div>
          </div>
  );

  return (
    <div className="min-h-screen reel_p overflow-x-hidden" key={`dynamic-${currentId}`}>
      {theaterMode && !isMobile ? (
        <>
          <div className="w-full py-4">
            <div className="mx-auto max-w-7xl px-4 max-h-[85vh] overflow-hidden [&_.aspect-video]:max-h-[85vh] [&_.aspect-video]:max-w-full [&_.aspect-video]:aspect-video">
              {videoBlock}
            </div>
          </div>
          <div className="mx-auto max-w-full xl:container py-6 px-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                {contentColumn}
              </div>
              {relatedColumn}
            </div>
          </div>
        </>
      ) : (
        <div className="mx-auto max-w-full xl:container py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {videoBlock}
              {contentColumn}
            </div>
            {relatedColumn}
          </div>
        </div>
      )}

      {imageUrl && (
        <ImagePreview imageUrl={imageUrl} setImageUrl={setImageUrl} />
      )}
    </div>
  );
}
export default index