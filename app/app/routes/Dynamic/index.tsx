import { data, useLoaderData, type MetaFunction } from "react-router";
import db from "~/lib/Database/supabase";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import HLSPlayer from "~/components/components/hlsplayer";
import { useState } from "react";
import RelatedVideos from "./components/RelatedVideos";
import type { FileType } from "~/lib/types";
import { BASE_URL } from "~/lib/URLS";

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

export const loader = async ({ params }: { params: { id: string } }) => {
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
      .limit(50);

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
        .slice(0, 50)
        .map(({ relatedScore, ...file }: any) => file);
    }

    return data({ file, relatedVideos }, { status: 200 });
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
          title: 'Error',
          description: 'Error loading file',
        }
      ];
    }

    const isHLS = data?.file?.file_type === 'application/vnd.apple.mpegurl' || data?.file?.endpoint?.includes('.m3u8');
    const thumbnail = isHLS ? `/api/load/image/${arrangeDateForThumbnail(data?.file?.created_at)}/${data?.file?.unique_id}/thumbnail_${data?.file?.filename.split(`.mp4.m3u8`)[0]}.jpg` : `/api/load/image/${data?.file?.endpoint}`;

    return [
      {
        title: `${data?.file?.filename?.split(`.mp4.m3u8`)[0]} - Memories`,
      },
      {
        name: 'description',
        content: `${data?.file?.filename?.split(`.mp4.m3u8`)[0]} | ${data?.file?.file_type} | ${data?.file?.file_size} | ${data?.file?.created_at} - Memories`
      },
      { property: "og:title", content: `${data?.file?.filename?.split(`.mp4.m3u8`)[0]} - Memories` },
      { property: "og:image", content: `${BASE_URL}${thumbnail}` },
      { name: "twitter:title", content: `${data?.file?.filename?.split(`.mp4.m3u8`)[0]} - Memories` },
      { name: "twitter:description", content: `${data?.file?.filename?.split(`.mp4.m3u8`)[0]} | ${data?.file?.file_type} | ${data?.file?.file_size} | ${data?.file?.created_at} - Memories` },
      { name: "twitter:image", content: `${BASE_URL}${thumbnail}` },
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


const arrangeDateForThumbnail = (created_at: string) => {
  const date = new Date(created_at)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = date.getFullYear()
  return `${day}_${month}_${year}`
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const index = () => {
  const [playingVideos, setPlayingVideos] = useState<Set<number>>(new Set());
  const data= useLoaderData<typeof loader>();
  const file = data?.file;
  const relatedVideos = data?.relatedVideos || [];
  
  if(!file) {
    return <div>File not found</div>
  }

  const isHLS = file?.file_type === 'application/vnd.apple.mpegurl' || file?.endpoint?.includes('.m3u8');


  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto px-6 xl:px-8 max-w-full xl:container py-6">
        <div className="gap-6 flex flex-col">
          <div className="xl:col-span-3 space-y-6">
            <div className="relative group">
              <div className="aspect-video bg-muted rounded-3xl overflow-hidden shadow-2xl ring-1 ring-border/50">
                {isHLS ? (
                  <HLSPlayer
                    src={`/api/load/video/${file.endpoint}`}
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
                    poster={`/api/load/image/${arrangeDateForThumbnail(file.created_at)}/${file.unique_id}/thumbnail_${file.filename.split(`.mp4.m3u8`)[0]}.jpg`}
                  />
                ) : (
                  <TransformWrapper>
                    <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
                      <img
                        src={`/api/load/image/${file.endpoint}`}
                        alt={file.filename}
                        className="w-full h-full object-contain rounded-3xl"
                      />
                    </TransformComponent>
                  </TransformWrapper>
                )}
              </div>
            </div>

            <div className="bg-card rounded-3xl p-8 shadow-lg ring-1 ring-border/50 overflow-x-auto">
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <h1 className="text-2xl font-bold text-foreground leading-tight">
                      {file.filename?.split(`.mp4.m3u8`)[0]}
                    </h1>
                    <div className="flex items-center gap-6 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${file.file_type.includes('video') ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                        <span className="font-medium">
                          {file.file_type.includes('video') ? 'Video' : 'Image'}
                        </span>
                      </div>
                      <span>{new Date(file.created_at).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}</span>
                      <span>{formatFileSize(file.file_size)}</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* <div>
                <LikeButton videoId={file.unique_id} />
                <ShareButton videoId={file.unique_id} />
              </div> */}
            </div>
          </div>

          <div className="xl:col-span-1">
            <div className="bg-card rounded-3xl shadow-lg ring-1 ring-border/50 overflow-hidden sticky top-6">
              <RelatedVideos videos={relatedVideos} currentVideoId={file.unique_id} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
export default index