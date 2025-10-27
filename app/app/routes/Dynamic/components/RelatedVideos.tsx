import { useState } from "react"
import { Badge } from "~/components/ui/badge"
import { motion } from "framer-motion"
import { Link } from "react-router"
import type { FileType } from "~/lib/types"
import VideoCard from "~/routes/Home/components/VideoCard"

interface RelatedVideosProps {
  videos: FileType[]
  currentVideoId: string
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

const RelatedVideoCard = ({ data }: { data: FileType }) => {
  const [error, setError] = useState<boolean>(false)

  return (
    <motion.div 
      className="group relative overflow-hidden bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 hover:bg-card/80 hover:border-border hover:shadow-lg hover:scale-[1.02] transition-all duration-300 ease-out"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      whileHover={{ y: -2 }}
    >
      <div className="flex gap-3 p-3">
        <Link to={`/${data.unique_id}`} className="flex-shrink-0">
          <div className="relative w-20 h-14 overflow-hidden bg-muted/50 rounded-xl">
            {!error ? (
              <img
                src={data.file_type.startsWith('image/') && data.endpoint 
                  ? `/api/load/image/${data.endpoint}` 
                  : `/api/load/image/${arrangeDateForThumbnail(data.created_at)}/${data.unique_id}/thumbnail_${data.filename.split(`.`)[0]}.jpg`}
                alt={`Thumbnail`}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={() => setError(true)}
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-muted/50">
                <div className="text-center">
                  <div className="w-6 h-6 mx-auto mb-1 rounded-full bg-muted flex items-center justify-center">
                    <span className="text-xs">📷</span>
                  </div>
                  <span className="text-xs text-muted-foreground">No preview</span>
                </div>
              </div>
            )}
            
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            
            {data.file_type.includes('video') && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-0 h-0 border-l-[4px] border-l-white border-y-[3px] border-y-transparent ml-0.5"></div>
                </div>
              </div>
            )}
          </div>
        </Link>
        
        <div className="flex-1 min-w-0 space-y-2">
          <Link to={`/${data.unique_id}`}>
            <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-tight cursor-pointer hover:text-primary transition-colors duration-200">
              {data.filename}
            </h3>
          </Link>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {new Date(data.created_at).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </span>
              <div className="w-1 h-1 bg-muted-foreground/30 rounded-full"></div>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(data.file_size)}
              </span>
            </div>
            
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${data.file_type.includes('video') ? 'bg-red-500' : 'bg-blue-500'}`}></div>
              <span className="text-xs text-muted-foreground font-medium">
                {data.file_type.includes('video') ? 'Video' : 'Image'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

const RelatedVideos = ({ videos, currentVideoId }: RelatedVideosProps) => {
  const filteredVideos = videos.filter(video => video.unique_id !== currentVideoId)
  const displayVideos = filteredVideos.slice(0, 50)

  if (displayVideos.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-6 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold text-foreground">Related</h2>
          </div>
          <p className="text-sm text-muted-foreground">Discover more content</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
              <span className="text-2xl">📹</span>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No related videos</h3>
            <p className="text-sm text-muted-foreground">Check back later for more content</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-foreground">Related</h2>
          <div className="px-3 py-1 bg-primary/10 rounded-full">
            <span className="text-xs font-semibold text-primary">{displayVideos.length}</span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Discover more content</p>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-5 gap-2 p-4">
        {displayVideos.map((video, index) => (
             <VideoCard
              key={index || 0}
              data={video as FileType}
             />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default RelatedVideos
