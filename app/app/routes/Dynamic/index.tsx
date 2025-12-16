import { data, Link, useLoaderData, useNavigate, type MetaFunction } from "react-router";
import db from "~/lib/Database/supabase";
import HLSPlayer from "~/components/components/hlsplayer";
import { useEffect, useState } from "react";
import RelatedVideos from "./components/RelatedVideos";
import type { FileType } from "~/lib/types";
import { BASE_URL } from "~/lib/URLS";
import ImageLoad from "../Home/components/ImageLoad/ImageLoad";
import { arrangeDateForThumbnail, ParseFilename } from "~/lib/utils";
import { motion } from "framer-motion";
import { MakeVideoToken } from "./components/Functions";
import { ShieldAlert } from "lucide-react";
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
    
    // Get likes and comments count
    const likesCount = Number(file?.up_count) || 0;
    const commentsCount = data?.commentsCount || 0;
    
    // Build description with likes and comments
    const statsText = `${likesCount} ${likesCount === 1 ? 'like' : 'likes'}${commentsCount > 0 ? ` • ${commentsCount} ${commentsCount === 1 ? 'comment' : 'comments'}` : ''}`;
    
    const displayDescription = (file?.file_description && file.file_description.trim() !== '')
      ? `${file.file_description} | ${statsText}`
      : `${ParseFilename(file?.filename || '')} | ${statsText} | ${file?.file_type} | ${file?.file_size}`;

    const isHLS = file?.file_type === 'application/vnd.apple.mpegurl' || file?.endpoint?.includes('.m3u8');
    let thumbnail = isHLS ? `/api/load/image/${arrangeDateForThumbnail(file?.created_at)}/${file?.unique_id}/thumbnail_${ParseFilename(file?.filename)}.jpg` : `/api/load/image/${file?.endpoint}`;
    thumbnail = `${thumbnail}?quality=15`

    return [
      {
        title: `${displayTitle} - Memories`,
      },
      {
        name: 'description',
        content: `${displayDescription} - Memories`
      },
      { property: "og:title", content: `${displayTitle} - Memories` },
      { property: "og:image", content: `${BASE_URL}${thumbnail}` },
      { property: "og:description", content: `${displayDescription} - Memories` },
      { name: "twitter:title", content: `${displayTitle} - Memories` },
      { name: "twitter:description", content: `${displayDescription} - Memories` },
      { name: "twitter:image", content: `${BASE_URL}${thumbnail}` },
      { name: "canonical", content: `${BASE_URL}/${data?.id}` },
      { name: "robots", content: "index, follow" },
      {rel: `preconnect`, href: `${BASE_URL}${thumbnail}`, as: `image`}
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
  const [playingVideos, setPlayingVideos] = useState<Set<number>>(new Set());
  const data = useLoaderData<typeof loader>();
  const file_data = data?.file;

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

  return (
    <div className="min-h-screen overflow-x-hidden">
      <div className="mx-auto max-w-full xl:container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <motion.div layoutId={`video_id_${file_data.unique_id}`} className="relative w-full">
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
                    muted={true}
                      loop={true}
                      playsInline
                      imageID={file_data.unique_id}
                      file={file_data}
                      key={file_data.unique_id}
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
                upCount={Number(file_data.up_count) || 0} 
                downCount={Number(file_data.down_count) || 0}
                fileId={file_data.id}
                initialLiked={('userLiked' in data && data.userLiked) || false}
                initialDisliked={('userDisliked' in data && data.userDisliked) || false}
                canDownload={('userId' in data && Boolean(data.userId))}
              />

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

              <CommentSection fileId={file_data.id} currentUserId={('userId' in data && data.userId) || undefined} />
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-6">
              <RelatedVideos 
                videos={relatedVideos} 
                currentVideoId={file_data.unique_id} 
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