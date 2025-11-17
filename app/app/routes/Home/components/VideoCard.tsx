import { useState } from "react"
import { Badge } from "~/components/ui/badge"
import { motion } from "framer-motion"
import { Link, useNavigate } from "react-router"
import type { FileType } from "~/lib/types"
import ImageLoad from "./ImageLoad/ImageLoad"
import { arrangeDateForThumbnail, ParseFilename } from "~/lib/utils"
import { ShieldAlert } from "lucide-react"

interface VideoCardProps {
  data: FileType
  index?: number
}


const base64URL = (url: string) => {
  return btoa(url)
}



const VideoCard = ({ data, index}: VideoCardProps) => {
  const [error, setError] = useState<boolean>(false)
  const [retryAttempt, setRetryAttempt] = useState<number>(0)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [showAdultTag] = useState<boolean>(Boolean(data.is_adult))

  const nav = useNavigate()

  const retry = () => {
    if(retryAttempt >= 1) {
      setError(true)
      return
    }
    setRetryAttempt(retryAttempt + 1)
  }

  // Make the opacity by the index 0 - 1 float
  const opacity = Math.min(Math.max(0, index || 0), 10) / 10
  return (
    <div className={` item group overflow-hidden rounded-2xl relative flex flex-col justify-between bg-card ring-1 ring-border/50 shadow-sm hover:shadow-md transition-all duration-300`}
      // initial={{opacity: opacity}}
      // animate={{opacity: 1}}
      // transition={{duration: 0, ease: "easeOut"}}
      // layoutId={`video_id_${data.unique_id}`}
    >
      <Link onClick={e => {
        e.preventDefault()
        nav(`/${data.unique_id}`)
      }} to={`/${data.unique_id}`}
      className={`h-full bg-card rounded-2xl overflow-hidden min-h-[200px]`}
      >
        <motion.div
          transition={{duration: 0.1, ease: "easeOut", damping: 10, stiffness: 100}}
          className={`h-full min-h-[200px]`}
        >
            <>
            {showAdultTag && (
              <>
                <div className="absolute inset-0 z-10 bg-black/50 pointer-events-none" />
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 text-center text-white px-4 pointer-events-none backdrop-blur-xl rounded-2xl overflow-hidden">
                  <ShieldAlert className="h-10 w-10 text-primary-foreground/80" />
                  <span className="text-sm font-semibold tracking-wide uppercase">
                    Sensitive Content
                  </span>
                  <p className="text-xs text-white/80 max-w-[200px]">
                    Tap to continue if you are comfortable viewing mature media.
                  </p>
                  <h1 className="hidden">Look! We are not stupid for not hiding the image of the adult content! So don't be too happy for that.</h1>
                </div>
                <div className="absolute top-3 left-3 z-20 pointer-events-none">
                  <Badge
                    variant="default"
                    className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-lg shadow-black/20 ring-1 ring-primary/40 bg-primary/90 backdrop-blur-sm"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    18 PG
                  </Badge>
                </div>
              </>
            )}
            {
                !error ? (
                  <ImageLoad 
                    link={data.file_type.startsWith('image/') && data.endpoint
                      ? `/api/load/image/${data.endpoint}`
                      : `/api/load/image/${arrangeDateForThumbnail(data.created_at, retryAttempt)}/${data.unique_id}/thumbnail_${ParseFilename(data.filename)}.jpg`} 
                    imageID={data.unique_id}
                    index={index}
                    retry={retry}
                    className={`${!loaded ? 'aspect-video' : ''} transition-all duration-300 min-h-[200px]`}
                    callBack={e => {
                      if(e) {
                        setLoaded(true)
                      }
                    }}
                    quality={25}
                    hasAdultTag={Boolean(data.is_adult)}
                  />
                ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted text-xs text-center">
                    <span>Failed to load image</span>
                </div>
                )
            }
            </>
        </motion.div>
      </Link>
      
      <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-300 p-3 space-y-2 pointer-events-none absolute flex flex-col justify-end bottom-0 left-0 right-0 h-full bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        <h3 className="text-white text-sm md:text-base font-semibold leading-tight line-clamp-2">
          {ParseFilename(data.filename)}
        </h3>
      </div>
    </div>
  )
}

export default VideoCard