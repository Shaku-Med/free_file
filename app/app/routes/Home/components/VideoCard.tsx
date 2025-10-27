import { useState } from "react"
import { Badge } from "~/components/ui/badge"
import { motion } from "framer-motion"
import { Link } from "react-router"
import type { FileType } from "~/lib/types"

interface VideoCardProps {
  data: FileType
  key?: number
}


const base64URL = (url: string) => {
  return btoa(url)
}

const arrangeDateForThumbnail = (created_at: string) => {
  const date = new Date(created_at)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = date.getFullYear()
  return `${day}_${month}_${year}`
}

const VideoCard = ({ data, key}: VideoCardProps) => {
  const [error, setError] = useState<boolean>(false)

  return (
    <motion.div className=" overflow-hidden"
      initial={{ y: 10  * (key || 0) }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Link to={`/${data.unique_id}`}
      >
        <div
          className="relative aspect-[16/9] overflow-hidden bg-muted text-xs cursor-pointer active:opacity-[.8]"
        >
            <>
            {
                !error ? (
                <img
                    src={data.file_type.startsWith('image/') && data.endpoint 
                        ? `/api/load/image/${data.endpoint}` 
                        : `/api/load/image/${arrangeDateForThumbnail(data.created_at)}/${data.unique_id}/thumbnail_${data.filename.split(`.mp4.m3u8`)[0]}.jpg`}
                    alt={`Thumbnail`}
                    className="w-full h-full object-cover"
                    onError={() => {
                    setError(true)
                    }}
                    loading="lazy"
                />
                ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted text-xs">
                    <span>Failed to load image</span>
                </div>
                )
            }
            </>
        </div>
      </Link>
      
      <div className="p-3 space-y-2">
        <Link to={`/${data.unique_id}`}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight cursor-pointer">
            {data.filename?.split(`.mp4.m3u8`)[0]}
          </h3>
        </Link>
      </div>
    </motion.div>
  )
}

export default VideoCard