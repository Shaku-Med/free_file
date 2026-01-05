import { data, Link, useLoaderData, useNavigate, useParams, useNavigation, type MetaFunction } from "react-router";
import db from "~/lib/Database/supabase";
import HLSPlayer from "~/components/components/hlsplayer";
import { useEffect, useState, useRef } from "react";
import RelatedVideos from "./components/RelatedVideos";
import type { FileType } from "~/lib/types";
import { BASE_URL } from "~/lib/URLS";
import ImageLoad from "../Home/components/ImageLoad/ImageLoad";
import { arrangeDateForThumbnail, ParseFilename, getRandomThumbnail } from "~/lib/utils";
import { motion } from "framer-motion";
import { MakeVideoToken } from "./components/Functions";
import { ShieldAlert, Eye, Share2 } from "lucide-react";
import { useSidebar } from "~/components/ui/sidebar";
import { checkFileAccess } from "./fun/accessControl";
import AdultContentBadge from "./components/AdultContentBadge";
import ImagePreview from "./components/ImagePreview/ImagePreview";
import UserAction from "../components/UserAction";
import { Separator } from "~/components/ui/separator";
import { getRandomVideos } from "./components/RelatedVideosService";
import { isAuthenticated } from "~/lib/Security/Password";
import CommentSection from "./components/Comments/CommentSection";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import { commentService } from "~/lib/Services/CommentService";
import { userActionsService } from "~/lib/Services/UserActionsService";
import DownloadButton from "./components/DownloadButton";
import { formatNumber } from "~/lib/utils/formatNumber";
import { useWatchTracking } from "~/lib/hooks/useWatchTracking";
import { IMAGE_BASE_URL } from "~/lib/URLS";

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
      return data({ file: null, id: params.id, relatedVideos: [], userLiked: false, userDisliked: false, userId: null, accessDenied: false as const, reason: undefined }, { status: 404 });
    }

    const accessControl = await checkFileAccess(request, file);

    if (!accessControl.allowed) {
      return data({ 
        file: null, 
        id: params.id, 
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

    const relatedVideos = await getRandomVideos(request, params.id, file, 20);

    const user = await isAuthenticated(request, ['id']);
    const userId = user?.id || null;

    let userLiked = false;
    let userDisliked = false;
    let relatedVideosUserActions = { likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() };

    if (user && user.id && file.id) {
      // Check like/dislike for current file
      const [likeResult, dislikeResult] = await Promise.all([
        db.from('likes').select('id').eq('user_id', user.id).eq('file_id', file.id).maybeSingle(),
        db.from('dislike').select('id').eq('user_id', user.id).eq('file_id', file.id).maybeSingle()
      ]);

      userLiked = !!likeResult.data;
      userDisliked = !!dislikeResult.data;

      // Fetch user actions for related videos in one query
      if (relatedVideos.length > 0) {
        const relatedFileIds = relatedVideos.map(v => v.id).filter(Boolean);
        if (relatedFileIds.length > 0) {
          relatedVideosUserActions = await userActionsService.getUserActions(user.id, relatedFileIds);
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
        { property: "og:video:url", content: `${BASE_URL}/api/load/video/${file?.endpoint}` },
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
  const {isMobile, state} = useSidebar();

  const retry = () => {
    if(retryAttempt >= 1) {
      return
    }
    setRetryAttempt(retryAttempt + 1)
  }

  const relatedVideos = (data && 'relatedVideos' in data) ? data.relatedVideos : [];
  
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

  return (
    <div className="min-h-screen overflow-x-hidden" key={`dynamic-${currentId}`}>
      <div className="mx-auto max-w-full xl:container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <motion.div layoutId={`video_id_${file_data.unique_id}`} className="relative w-full" key={`motion-${file_data.unique_id}-${currentId}`}>
              {file_data?.is_adult && (
                <AdultContentBadge isPlaying={playingVideos.has(1)} className="top-3 left-3" />
              )}

                <div className={`${isHLS ? 'aspect-video bg-black rounded-lg overflow-hidden w-full' : 'w-full flex items-center justify-center overflow-hidden rounded-lg bg-black'} relative`}>
                  {isHLS ? (
                    <HLSPlayer
                      src={`/api/load/video/${file_data.endpoint}`}
                      className="w-full h-full"
                      onPlay={() => setPlayingVideos(prev => new Set(prev).add(1))}
                      onPause={() => setPlayingVideos(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(1);
                        return newSet;
                      })}
                    autoPlay={true}
                    muted={false}
                      loop={true}
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

            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold text-foreground leading-tight mb-2">
                  {(file_data.file_title && file_data.file_title.trim() !== '') 
                    ? file_data.file_title 
                    : ParseFilename(file_data.filename)}
                </h1>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  {('owner' in data && data.owner) && (
                    <OwnerProfile owner={data.owner} size="md" />
                  )}
                  <span>{new Date(file_data.created_at).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}</span>
                </div>
              </div>

              <Separator />

              <UserAction 
                key={`user-action-${file_data.id}-${currentId}`}
                upCount={Number(file_data.up_count) || 0} 
                downCount={Number(file_data.down_count) || 0}
                fileId={file_data.id}
                initialLiked={('userLiked' in data && data.userLiked) || false}
                initialDisliked={('userDisliked' in data && data.userDisliked) || false}
                canDownload={('userId' in data && Boolean(data.userId))}
              />

              <Separator />

              {/* Views and Shares Count */}
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  <span className="font-medium">{formatNumber(views)}</span>
                  <span className="text-xs">views</span>
                </div>
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4" />
                  <span className="font-medium">{formatNumber(shares)}</span>
                  <span className="text-xs">shares</span>
                </div>
              </div>

              <Separator />

              {/* <DownloadButton fileId={file_data.id} /> */}

              {(file_data.file_description && file_data.file_description.trim() !== '') && (
                <>
                  <Separator />
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {file_data.file_description}
                    </p>
                  </div>
                </>
              )}

              <Separator />

              <CommentSection 
                key={`comments-${file_data.id}-${currentId}`}
                fileId={file_data.id} 
                currentUserId={('userId' in data && data.userId) || undefined} 
              />
            </div>
          </div>

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
        </div>
      </div>

      {imageUrl && (
        <ImagePreview imageUrl={imageUrl} setImageUrl={setImageUrl} />
      )}
    </div>
  )
}
export default index