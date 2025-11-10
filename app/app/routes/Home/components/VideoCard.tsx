import { useState } from "react"
import { Badge } from "~/components/ui/badge"
import { motion } from "framer-motion"
import { Link, useNavigate } from "react-router"
import type { FileType } from "~/lib/types"
import ImageLoad from "./ImageLoad/ImageLoad"
import { arrangeDateForThumbnail, ParseFilename } from "~/lib/utils"

interface VideoCardProps {
  data: FileType
  key?: number
  index?: number
}


const base64URL = (url: string) => {
  return btoa(url)
}



const VideoCard = ({ data, key, index}: VideoCardProps) => {
  const [error, setError] = useState<boolean>(false)
  const [retryAttempt, setRetryAttempt] = useState<number>(0)
  const [loaded, setLoaded] = useState<boolean>(false)

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
        nav(`/${data.unique_id}`, {
          replace: true
        })
      }} to={`/${data.unique_id}`}
      className={`h-full bg-card rounded-2xl overflow-hidden min-h-[200px]`}
      >
        <motion.div
          transition={{duration: 0.1, ease: "easeOut", damping: 10, stiffness: 100}}
          className={`h-full min-h-[200px]`}
        >
            <>
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