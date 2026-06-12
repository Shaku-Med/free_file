import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from "react"
import type { FileType } from "~/lib/types"
import { personalizationService } from "~/lib/Services/PersonalizationService"

interface RelatedVideosContextType {
  displayVideos: FileType[]
  setDisplayVideos: React.Dispatch<React.SetStateAction<FileType[]>>
  isLoading: boolean
  hasMore: boolean
  observerRef: React.RefObject<HTMLDivElement | null>
  userActions: { likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined
  setUserActions: React.Dispatch<React.SetStateAction<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined>>
  loadMore: () => Promise<void>
}

const RelatedVideosContext = createContext<RelatedVideosContextType | undefined>(undefined)

export const useRelatedVideosContext = () => {
  const context = useContext(RelatedVideosContext)
  if (!context) {
    throw new Error("useRelatedVideosContext must be used within RelatedVideosProvider")
  }
  return context
}

interface RelatedVideosProviderProps {
  children: React.ReactNode
  currentVideoId: string
  currentVideoDbId?: string
  ownerId?: string
  initialVideos: FileType[]
  initialUserActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> }
}

export const RelatedVideosProvider = ({
  children,
  currentVideoId,
  currentVideoDbId,
  initialVideos,
  initialUserActions
}: RelatedVideosProviderProps) => {
  const filteredVideos = initialVideos.filter(video => video.unique_id !== currentVideoId)
  const [displayVideos, setDisplayVideos] = useState<FileType[]>(filteredVideos)
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const observerRef = useRef<HTMLDivElement | null>(null)
  // Next page for related: server gave us filteredVideos.length for page 1, so next is cursor_pos = that count
  const nextCursorRef = useRef<{ cursor_pos: number } | null>(
    filteredVideos.length > 0 ? { cursor_pos: filteredVideos.length } : null
  )
  const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined>(
    initialUserActions ? {
      likedFileIds: new Set(initialUserActions.likedFileIds),
      dislikedFileIds: new Set(initialUserActions.dislikedFileIds)
    } : undefined
  )

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore || !currentVideoDbId) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("fileId", currentVideoDbId)
      const cursor = nextCursorRef.current
      if (cursor) {
        params.set("cursor_pos", String(cursor.cursor_pos))
      }
      const sCats = personalizationService.getSessionCategories()
      if (sCats.length > 0) {
        params.set("session_cats", JSON.stringify(sCats))
      }

      const response = await fetch(`/api/related-videos?${params}`)
      if (!response.ok) {
        setHasMore(false)
        return
      }

      const result = await response.json()
      if (Array.isArray(result?.data)) {
        const filtered = result.data.filter((video: FileType) => video.unique_id !== currentVideoId)
        if (filtered.length > 0) {
          setDisplayVideos(prev => {
            const existingIds = new Set(prev.map((v: FileType) => v.id))
            const newItems = filtered.filter((v: FileType) => !existingIds.has(v.id))
            return [...prev, ...newItems]
          })
        }
        nextCursorRef.current = result.nextCursor ?? null
        setHasMore(Boolean(result.nextCursor))
        if (result.userActions) {
          setUserActions(prev => {
            const newLikedIds = new Set(prev?.likedFileIds || [])
            const newDislikedIds = new Set(prev?.dislikedFileIds || [])
            result.userActions.likedFileIds?.forEach((id: string) => newLikedIds.add(id))
            result.userActions.dislikedFileIds?.forEach((id: string) => newDislikedIds.add(id))
            return { likedFileIds: newLikedIds, dislikedFileIds: newDislikedIds }
          })
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
  }, [isLoading, hasMore, currentVideoId, currentVideoDbId])

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

  const value = useMemo(
    () => ({
      displayVideos,
      setDisplayVideos,
      isLoading,
      hasMore,
      observerRef,
      userActions,
      setUserActions,
      loadMore,
    }),
    [displayVideos, isLoading, hasMore, userActions, loadMore]
  )

  return <RelatedVideosContext.Provider value={value}>{children}</RelatedVideosContext.Provider>
}
