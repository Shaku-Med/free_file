import { useState, useCallback, useRef, useEffect } from "react"
import type { FileType } from "~/lib/types"
import RelatedVideoCard from "./RelatedVideoCard"
import { Button } from "~/components/ui/button"

interface RelatedVideosProps {
  videos: FileType[]
  currentVideoId: string
  currentUserId?: string
  currentFileType?: string
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> }
}

const RelatedVideos = ({ videos, currentVideoId, currentUserId, currentFileType, userActions: initialUserActions }: RelatedVideosProps) => {
  const filteredVideos = videos.filter(video => video.unique_id !== currentVideoId)
  const [displayVideos, setDisplayVideos] = useState<FileType[]>(filteredVideos.slice(0, 10))
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(filteredVideos.length > 10)
  const [currentPage, setCurrentPage] = useState(1)
  const observerRef = useRef<HTMLDivElement | null>(null)
  const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined>(
    initialUserActions ? {
      likedFileIds: new Set(initialUserActions.likedFileIds),
      dislikedFileIds: new Set(initialUserActions.dislikedFileIds)
    } : undefined
  )

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return

    setIsLoading(true)
    try {
      const nextPage = currentPage + 1
      const response = await fetch(
        `/api/related-videos?excludeId=${currentVideoId}&page=${nextPage}&limit=10${currentFileType ? `&fileType=${encodeURIComponent(currentFileType)}` : ''}`
      )

      if (!response.ok) {
        setHasMore(false)
        return
      }

      const result = await response.json()

      if (result.data && result.data.length > 0) {
        setDisplayVideos(prev => [...prev, ...result.data])
        setCurrentPage(nextPage)
        setHasMore(result.pagination?.hasMore || false)
        
        // Merge user actions from API response
        if (result.userActions) {
          setUserActions(prev => {
            const newLikedIds = new Set(prev?.likedFileIds || []);
            const newDislikedIds = new Set(prev?.dislikedFileIds || []);
            result.userActions.likedFileIds?.forEach((id: string) => newLikedIds.add(id));
            result.userActions.dislikedFileIds?.forEach((id: string) => newDislikedIds.add(id));
            return { likedFileIds: newLikedIds, dislikedFileIds: newDislikedIds };
          });
        }
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error("Error loading more related videos:", error)
      setHasMore(false)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, hasMore, currentPage, currentVideoId, currentFileType])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (observerRef.current) {
      observer.observe(observerRef.current)
    }

    return () => observer.disconnect()
  }, [loadMore, hasMore, isLoading])

  if (displayVideos.length === 0 && !isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Up next</h2>
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">No related videos available</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Up next</h2>
      <div className="space-y-3">
        {displayVideos.map((video) => (
          <RelatedVideoCard key={video.unique_id} data={video} currentUserId={currentUserId} userActions={userActions} />
        ))}
      </div>
      {hasMore && (
        <div ref={observerRef} className="h-10 flex items-center justify-center">
          {isLoading && (
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-muted-foreground">Loading more...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default RelatedVideos
