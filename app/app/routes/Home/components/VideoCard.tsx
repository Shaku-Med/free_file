import { useState, useCallback, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { Link, useNavigate } from "react-router"
import { ThumbsUp, ThumbsDown } from "lucide-react"
import { Button } from "~/components/ui/button"
import type { FileType } from "~/lib/types"
import ImageLoad from "./ImageLoad/ImageLoad"
import { arrangeDateForThumbnail, ParseFilename, getRandomThumbnail } from "~/lib/utils"
import AdultContentBadge from "~/routes/Dynamic/components/AdultContentBadge"
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile"

interface VideoCardProps {
  data: FileType
  index?: number
  currentUserId?: string
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> }
}

const VideoCard = ({ data, index, currentUserId, userActions }: VideoCardProps) => {
  
  const [error, setError] = useState<boolean>(false)
  const [retryAttempt, setRetryAttempt] = useState<number>(0)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [liked, setLiked] = useState(userActions?.likedFileIds?.has(data.id) || false)
  const [disliked, setDisliked] = useState(userActions?.dislikedFileIds?.has(data.id) || false)
  const [upCount, setUpCount] = useState(Number(data.up_count) || 0)
  const [downCount, setDownCount] = useState(Number(data.down_count) || 0)
  const [isLoading, setIsLoading] = useState(false)

  const nav = useNavigate()
  const likeDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const dislikeDebounceRef = useRef<NodeJS.Timeout | null>(null)

  const retry = () => {
    if(retryAttempt >= 1) {
      setError(true)
      return
    }
    setRetryAttempt(retryAttempt + 1)
  }

  // Update liked/disliked state when userActions change
  useEffect(() => {
    if (userActions && data.id) {
      setLiked(userActions.likedFileIds.has(data.id))
      setDisliked(userActions.dislikedFileIds.has(data.id))
    }
  }, [userActions, data.id])

  const handleLike = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!currentUserId || !data.id) {
      window.location.href = '/auth/login'
      return
    }

    const wasLiked = liked
    const wasDisliked = disliked

    if (wasDisliked) {
      setDisliked(false)
      setDownCount(prev => Math.max(0, prev - 1))
    }

    const newLiked = !wasLiked
    setLiked(newLiked)
    setUpCount(prev => newLiked ? prev + 1 : Math.max(0, prev - 1))

    if (likeDebounceRef.current) {
      clearTimeout(likeDebounceRef.current)
    }

    likeDebounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const method = newLiked ? 'POST' : 'DELETE'
        const response = await fetch('/api/likes', {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileId: data.id }),
        })

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = '/auth/login'
            return
          }
          throw new Error('Failed to update like')
        }

        const result = await response.json()
        if (result.success && result.upCount !== undefined && result.downCount !== undefined) {
          setUpCount(result.upCount)
          setDownCount(result.downCount)
        }
      } catch (error) {
        console.error('Error updating like:', error)
        setLiked(wasLiked)
        setDisliked(wasDisliked)
        setUpCount(Number(data.up_count) || 0)
        setDownCount(Number(data.down_count) || 0)
      } finally {
        setIsLoading(false)
      }
    }, 500)
  }, [liked, disliked, data.id, data.up_count, data.down_count, currentUserId])

  const handleDislike = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!currentUserId || !data.id) {
      window.location.href = '/auth/login'
      return
    }

    const wasLiked = liked
    const wasDisliked = disliked

    if (wasLiked) {
      setLiked(false)
      setUpCount(prev => Math.max(0, prev - 1))
    }

    const newDisliked = !wasDisliked
    setDisliked(newDisliked)
    setDownCount(prev => newDisliked ? prev + 1 : Math.max(0, prev - 1))

    if (dislikeDebounceRef.current) {
      clearTimeout(dislikeDebounceRef.current)
    }

    dislikeDebounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const method = newDisliked ? 'POST' : 'DELETE'
        const response = await fetch('/api/dislikes', {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileId: data.id }),
        })

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = '/auth/login'
            return
          }
          throw new Error('Failed to update dislike')
        }

        const result = await response.json()
        if (result.success && result.upCount !== undefined && result.downCount !== undefined) {
          setUpCount(result.upCount)
          setDownCount(result.downCount)
        }
      } catch (error) {
        console.error('Error updating dislike:', error)
        setLiked(wasLiked)
        setDisliked(wasDisliked)
        setUpCount(Number(data.up_count) || 0)
        setDownCount(Number(data.down_count) || 0)
      } finally {
        setIsLoading(false)
      }
    }, 500)
  }, [liked, disliked, data.id, data.up_count, data.down_count, currentUserId])

  useEffect(() => {
    return () => {
      if (likeDebounceRef.current) {
        clearTimeout(likeDebounceRef.current)
      }
      if (dislikeDebounceRef.current) {
        clearTimeout(dislikeDebounceRef.current)
      }
    }
  }, [])

  return (
    <div className="item group overflow-hidden rounded-2xl relative flex flex-col justify-between bg-card ring-1 ring-border/50 shadow-sm hover:shadow-md transition-all duration-300 w-full aspect-video min-h-[200px]">
      <Link 
        onClick={e => {
          e.preventDefault()
          nav(`/${data.unique_id}`)
        }} 
        to={`/${data.unique_id}`}
        className="h-full w-full bg-card rounded-2xl overflow-hidden relative"
      >
        {data.is_adult && <AdultContentBadge />}
        
        <motion.div
          transition={{duration: 0.1, ease: "easeOut", damping: 10, stiffness: 100}}
          className="h-full w-full"
        >
          {!error ? (
            <ImageLoad 
              link={(() => {
                if (data.file_type.startsWith('image/') && data.endpoint) {
                  return `/api/load/image/${data.endpoint}`
                }
                const randomThumbnail = getRandomThumbnail(data.thumbnails)
                if (randomThumbnail) {
                  return `/api/load/image/${randomThumbnail}`
                }
                return `/api/load/image/${arrangeDateForThumbnail(data.created_at, retryAttempt)}/${data.unique_id}/thumbnail_${ParseFilename(data.filename)}.jpg`
              })()} 
              imageID={data.unique_id}
              index={index}
              retry={() => {
                if (retryAttempt >= 1) {
                  setError(true)
                  return
                }
                setRetryAttempt(prev => prev + 1)
              }}
              className="w-full h-full object-cover transition-all duration-300"
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
          )}
        </motion.div>
      </Link>
      
      <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-300 p-3 space-y-2 pointer-events-none absolute flex flex-col justify-end bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pb-4">
        <h3 className="text-white text-sm md:text-base font-semibold leading-tight line-clamp-2 mb-1">
          {data.file_title || ParseFilename(data.filename)}
        </h3>
        
        {data.owner && (
          <div className="pointer-events-auto mb-1">
            <OwnerProfile owner={data.owner} size="sm" className="text-white/90 hover:text-white" />
          </div>
        )}
        
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleLike}
            disabled={isLoading || !data.id}
            className={`h-7 w-7 p-0 bg-black/40 hover:bg-black/60 ${liked ? 'text-primary' : 'text-white'}`}
          >
            <ThumbsUp className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} />
          </Button>
          <span className="text-xs text-white min-w-[20px]">{upCount}</span>
          
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDislike}
            disabled={isLoading || !data.id}
            className={`h-7 w-7 p-0 bg-black/40 hover:bg-black/60 ${disliked ? 'text-destructive' : 'text-white'}`}
          >
            <ThumbsDown className={`h-3.5 w-3.5 ${disliked ? 'fill-current' : ''}`} />
          </Button>
          <span className="text-xs text-white min-w-[20px]">{downCount}</span>
        </div>
      </div>
    </div>
  )
}

export default VideoCard
