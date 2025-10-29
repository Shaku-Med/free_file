import { useState } from "react"
import { Badge } from "~/components/ui/badge"
import { motion } from "framer-motion"
import { Link } from "react-router"
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

  const retry = () => {
    if(retryAttempt >= 1) {
      setError(true)
      return
    }
    setRetryAttempt(retryAttempt + 1)
  }

  return (
    <motion.div className=" overflow-hidden flex flex-col justify-between"
      initial={{ y: 10  * (index || 0) }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Link to={`/${data.unique_id}`}
      className={`h-full`}
      >
        <div
          className={`h-full`}
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
                  />
                ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted text-xs text-center">
                    <span>Failed to load image</span>
                </div>
                )
            }
            </>
        </div>
      </Link>
      
      <div className="p-3 space-y-2">
        <Link to={`/${data.unique_id}`}>
          <h3 className="text-sm font-semibold line-clamp-2 leading-tight cursor-pointer">
            {ParseFilename(data.filename)}
          </h3>
        </Link>
      </div>
    </motion.div>
  )
}

export default VideoCard