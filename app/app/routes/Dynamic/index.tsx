import { data, Link, useLoaderData, type MetaFunction } from "react-router";
import db from "~/lib/Database/supabase";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import HLSPlayer from "~/components/components/hlsplayer";
import { useEffect, useState } from "react";
import RelatedVideos from "./components/RelatedVideos";
import type { FileType } from "~/lib/types";
import { BASE_URL } from "~/lib/URLS";
import ImageLoad from "../Home/components/ImageLoad/ImageLoad";
import { arrangeDateForThumbnail, ParseFilename } from "~/lib/utils";
import { motion } from "framer-motion";
import { MakeVideoToken } from "./components/Functions";
import { ChevronLeft, ChevronRight, EyeOff, ShieldAlert } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import ImagePreview from "./components/ImagePreview/ImagePreview";
import { useSidebar } from "~/components/ui/sidebar";
import GradientColors from "~/components/Navbar/components/GradientColors";

const calculateTextSimilarity = (str1: string, str2: string): number => {
  const normalize = (str: string) => str.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const s1 = normalize(str1);
  const s2 = normalize(str2);
  
  if (s1 === s2) return 1.0;
  
  const words1 = s1.split(/\s+/).filter(w => w.length > 2);
  const words2 = s2.split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 && words2.length === 0) return 0;
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const commonWords = words1.filter(word => words2.includes(word));
  const unionWords = [...new Set([...words1, ...words2])];
  
  const jaccardSimilarity = commonWords.length / unionWords.length;
  
  const levenshteinDistance = (a: string, b: string): number => {
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    return matrix[b.length][a.length];
  };
  
  const maxLength = Math.max(s1.length, s2.length);
  const editDistance = levenshteinDistance(s1, s2);
  const levenshteinSimilarity = maxLength === 0 ? 1 : (maxLength - editDistance) / maxLength;
  
  return (jaccardSimilarity * 0.7 + levenshteinSimilarity * 0.3);
};

const calculateFileTypeSimilarity = (type1: string, type2: string): number => {
  if (type1 === type2) return 1.0;
  
  const getMainType = (type: string) => type.split('/')[0];
  const mainType1 = getMainType(type1);
  const mainType2 = getMainType(type2);
  
  if (mainType1 === mainType2) return 0.8;
  
  const compatibleTypes = [
    ['video', 'application/vnd.apple.mpegurl'],
    ['image', 'image']
  ];
  
  for (const [category, prefix] of compatibleTypes) {
    if ((mainType1 === category || type1.startsWith(prefix)) && 
        (mainType2 === category || type2.startsWith(prefix))) {
      return 0.6;
    }
  }
  
  return 0.2;
};

const calculateTemporalProximity = (date1: string, date2: string): number => {
  const time1 = new Date(date1).getTime();
  const time2 = new Date(date2).getTime();
  const diffDays = Math.abs(time1 - time2) / (1000 * 60 * 60 * 24);
  
  if (diffDays <= 1) return 1.0;
  if (diffDays <= 7) return 0.8;
  if (diffDays <= 30) return 0.6;
  if (diffDays <= 90) return 0.4;
  if (diffDays <= 365) return 0.2;
  return 0.1;
};

const calculateRelatedScore = (currentFile: FileType, candidateFile: FileType): number => {
  const textScore = calculateTextSimilarity(currentFile.filename, candidateFile.filename);
  const typeScore = calculateFileTypeSimilarity(currentFile.file_type, candidateFile.file_type);
  const temporalScore = calculateTemporalProximity(currentFile.created_at, candidateFile.created_at);
  
  return (textScore * 0.5 + typeScore * 0.3 + temporalScore * 0.2);
};


const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
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

    const { data: allFiles, error: allFilesError } = await db
      .from('files')
      .select('*')
      .neq('unique_id', params.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (allFilesError) {
      console.error('Error fetching all files:', allFilesError);
    }

    let relatedVideos: FileType[] = [];
    if (file && allFiles) {
      const scoredFiles = allFiles.map((candidateFile: FileType) => ({
        ...candidateFile,
        relatedScore: calculateRelatedScore(file, candidateFile)
      }));
      
      relatedVideos = scoredFiles
        .sort((a: any, b: any) => b.relatedScore - a.relatedScore)
        .slice(0, 10)
        .map(({ relatedScore, ...file }: any) => file);
    }

    let previousFile: FileType | null = null;
    let nextFile: FileType | null = null;

    if (file?.created_at) {
      const { data: previous, error: previousError } = await db
        .from('files')
        .select('*')
        .lt('created_at', file.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (previousError) {
        console.error('Error fetching previous file:', previousError);
      }

      if (previous) {
        previousFile = previous as FileType;
      }

      const { data: next, error: nextError } = await db
        .from('files')
        .select('*')
        .gt('created_at', file.created_at)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextError) {
        console.error('Error fetching next file:', nextError);
      }

      if (next) {
        nextFile = next as FileType;
      }
    }

    let videoToken = await MakeVideoToken(file?.file_type, params.id, request.headers)
    const path = new URL(request.url).pathname;
    let headers = new Headers();
    
    if(videoToken) {
      let vid_path = `/api/load/video/${file.endpoint.split(`${path}`)[0]}${path}`
      headers.append('Set-Cookie', `videoToken=${videoToken}; Path=${vid_path}; Max-Age=86400; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure' : ''}; SameSite=Strict, priority=high`);
      headers.append('Set-Cookie', `validator=${videoToken}; Path=/; Max-Age=86400; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure' : ''}; SameSite=Strict, priority=high`);
    }

    return data({ file, relatedVideos, id: params.id, pagination: { previous: previousFile, next: nextFile } }, { 
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
    if(!data) {
      return [
        {
          title: 'Not Found',
          description: 'File not found',
        }
      ];
    }

    const isHLS = data?.file?.file_type === 'application/vnd.apple.mpegurl' || data?.file?.endpoint?.includes('.m3u8');
    let thumbnail = isHLS ? `/api/load/image/${arrangeDateForThumbnail(data?.file?.created_at)}/${data?.file?.unique_id}/thumbnail_${ParseFilename(data?.file?.filename)}.jpg` : `/api/load/image/${data?.file?.endpoint}`;
    thumbnail = `${thumbnail}?quality=15`

    return [
      {
        title: `${ParseFilename(data?.file?.filename)} - Memories`,
      },
      {
        name: 'description',
        content: `${ParseFilename(data?.file?.filename)} | ${data?.file?.file_type} | ${data?.file?.file_size} | ${data?.file?.created_at} - Memories`
      },
      { property: "og:title", content: `${ParseFilename(data?.file?.filename)} - Memories` },
      { property: "og:image", content: `${BASE_URL}${thumbnail}` },
      { name: "twitter:title", content: `${ParseFilename(data?.file?.filename)} - Memories` },
      { name: "twitter:description", content: `${ParseFilename(data?.file?.filename)} | ${data?.file?.file_type} | ${data?.file?.file_size} | ${data?.file?.created_at} - Memories` },
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
  const data= useLoaderData<typeof loader>();
  const file_data = data?.file;
  const relatedVideos = data?.relatedVideos || [];
  const previousFile = data?.pagination?.previous ?? null;
  const nextFile = data?.pagination?.next ?? null;

  const [poster, setPoster] = useState<string | null>(null);
  
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
  const [showAdultContent, setShowAdultContent] = useState<boolean>(file_data?.is_adult ?? false)
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

  useEffect(() => {
    if (!file_data?.is_adult) {
      setShowAdultContent(false);
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const hasAccepted = sessionStorage.getItem("adultContentAcknowledged") === "true";
    setShowAdultContent(!hasAccepted);
  }, [file_data?.is_adult, file_data?.unique_id]);

  const handleRevealAdultContent = () => {
    if (typeof window !== "undefined") {
      const confirmOpen = window.confirm("This content may be unsafe. Do you want to proceed?");
      if (!confirmOpen) {
        return;
      }
      sessionStorage.setItem("adultContentAcknowledged", "true");
    }

    setShowAdultContent(false);
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      <div className="mx-auto max-w-full xl:container py-6">
        <div className="gap-6 flex flex-col">
          <div className="xl:col-span-3 space-y-6">
            <motion.div layoutId={`video_id_${file_data.unique_id}`} className="relative group flex items-center justify-between min-h-[300px] gap-4 w-full">
              {/* {imageColors && <GradientColors colors={imageColors} />} */}
              {file_data?.is_adult && (
                <div className="absolute top-3 left-3 z-[100000] pointer-events-none">
                  <Badge className="flex items-center gap-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-lg shadow-black/20 ring-1 ring-primary/40 bg-primary/90 backdrop-blur-sm">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    18+
                  </Badge>
                </div>
              )}

              {
                !showAdultContent ? (
                  <>
                     <div className={`${isHLS ? `aspect-video bg-muted rounded-3xl overflow-hidden shadow-2xl ring-1 ring-border/50 w-full` : `w-fit h-full min-h-[200px] w-full flex items-center justify-center overflow-hidden rounded-4xl ${isMobile || state === 'collapsed' ? `bg-[transparent]` : `bg-[transparent]`}`} min-w-0 h-full relative`}>
                      {isHLS ? (
                        <HLSPlayer
                          src={`/api/load/video/${file_data.endpoint}`}
                          className="w-full h-full rounded-3xl"
                          onPlay={() => setPlayingVideos(prev => new Set(prev).add(1))}
                          onPause={() => setPlayingVideos(prev => {
                            const newSet = new Set(prev);
                            newSet.delete(1);
                            return newSet;
                          })}
                          autoPlay={playingVideos.has(1)}
                          muted={false}
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
                          onClick={e => {
                            if(madeImageUrl) {
                              setImageUrl({ url: madeImageUrl, imageID: file_data.unique_id })
                            }
                          }} layoutId={`image_id_${file_data.unique_id}`} className="w-full h-[500px] max-h-[500px] cursor-zoom-in z-[100]">
                            <ImageLoad
                              link={`/api/load/image/${file_data.endpoint}`}
                              retry={retry}
                              className="w-full h-full object-contain rounded-3xl"
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
                  </>
                ) : (
                  <>
                  <div className="absolute inset-0 backdrop-blur-lg text-center flex flex-col items-center justify-center gap-3 px-4">
                    <EyeOff className="w-10 h-10 text-white" />
                    <span className="text-white text-sm font-medium">Unsafe content</span>
                    <p className="text-white text-xs max-w-xs">This content may not be suitable for all audiences. Please confirm to continue.</p>
                    <button
                      type="button"
                      onClick={handleRevealAdultContent}
                      className="px-4 py-2 text-sm font-medium text-white border border-white/40 rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white transition"
                    >
                      View content
                    </button>
                  </div>
                  </>
                )
              }

             
            </motion.div>
            
            <div className="flex items-center justify-between">
                {previousFile && (
                  <Link
                    className={`flex-shrink-0 flex items-center justify-center rounded-full border text-foreground w-12 h-12 md:w-14 md:h-14 shadow-lg hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-400 transition-colors ${isMobile || state === 'collapsed' ? `bg-card` : `bg-background`}`}
                    to={`/${previousFile.unique_id}`}
                    aria-label="Previous file"
                    title={ParseFilename(previousFile.filename)}
                  >
                    <ChevronLeft className="w-7 h-7" />
                  </Link>
                )}

                {nextFile && (
                    <Link
                      className={`flex-shrink-0 flex items-center justify-center rounded-full border text-foreground w-12 h-12 md:w-14 md:h-14 shadow-lg hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-400 transition-colors ${isMobile || state === 'collapsed' ? `bg-card` : `bg-background`}`}
                      to={`/${nextFile.unique_id}`}
                      aria-label="Next file"
                      title={ParseFilename(nextFile.filename)}
                    >
                      <ChevronRight className="w-7 h-7" />
                    </Link>
                  )}
            </div>


            <div className={`${(isMobile || state === 'collapsed' ? `bg-card` : `bg-background`)} rounded-3xl p-8 shadow-lg ring-1 ring-border/50 overflow-x-auto relative w-full`}>
              <div className="space-y-4 z-[1000]">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <h1 className="text-2xl font-bold text-foreground leading-tight line-clamp-1 flex items-center flex-wrap">
                      {ParseFilename(file_data.filename)?.split(``)?.map((part, index) => (
                        <span key={index}>{part}</span>
                      ))}
                    </h1>
                    <div className="flex items-center gap-6 text-sm text-muted-foreground">
                      <span>{new Date(file_data.created_at).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* <Separator/> */}
              {/* <div>
                <LikeButton videoId={file_data.unique_id} />
                <ShareButton videoId={file_data.unique_id} />
              </div> */}
            </div>
          </div>

          <div className="xl:col-span-1">
            <div className={`${(isMobile || state === 'collapsed' ? `bg-card` : `bg-background`)} rounded-3xl shadow-lg ring-1 ring-border/50 overflow-hidden sticky top-6`}>
              <RelatedVideos videos={relatedVideos} currentVideoId={file_data.unique_id} key={file_data.unique_id} />
            </div>
          </div>
        </div>
      </div>

      {/* Image Preview */}
      {imageUrl && (
        <ImagePreview imageUrl={imageUrl} setImageUrl={setImageUrl} />
      )}
    </div>
  )
}
export default index