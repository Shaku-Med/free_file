import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from "react"
import type { FileType } from "~/lib/types"

type TabType = "upnext" | "creator"

interface RelatedVideosContextType {
  activeTab: TabType
  setActiveTab: (tab: TabType) => void
  displayVideos: FileType[]
  setDisplayVideos: React.Dispatch<React.SetStateAction<FileType[]>>
  ownerVideos: FileType[]
  setOwnerVideos: React.Dispatch<React.SetStateAction<FileType[]>>
  isLoading: boolean
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
  isLoadingOwner: boolean
  setIsLoadingOwner: React.Dispatch<React.SetStateAction<boolean>>
  hasMore: boolean
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>
  hasMoreOwner: boolean
  setHasMoreOwner: React.Dispatch<React.SetStateAction<boolean>>
  ownerPage: number
  setOwnerPage: React.Dispatch<React.SetStateAction<number>>
  observerRef: React.RefObject<HTMLDivElement | null>
  userActions: { likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined
  setUserActions: React.Dispatch<React.SetStateAction<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined>>
  loadMore: () => Promise<void>
  loadOwnerVideos: () => Promise<void>
}

const RelatedVideosContext = createContext<RelatedVideosContextType | undefined>(undefined)

function isMarkedAdult(isAdult: unknown): boolean {
  if (isAdult === true || isAdult === 1) return true
  if (typeof isAdult === "string" && ["true", "t", "1", "yes", "y"].includes(isAdult.trim().toLowerCase())) {
    return true
  }
  return false
}

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
  ownerId,
  initialVideos,
  initialUserActions
}: RelatedVideosProviderProps) => {
  const filteredVideos = initialVideos.filter(video => video.unique_id !== currentVideoId)
  const [activeTab, setActiveTab] = useState<TabType>("upnext")
  const [displayVideos, setDisplayVideos] = useState<FileType[]>(filteredVideos.slice(0, 10))
  const [ownerVideos, setOwnerVideos] = useState<FileType[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingOwner, setIsLoadingOwner] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [hasMoreOwner, setHasMoreOwner] = useState(true)
  const [ownerPage, setOwnerPage] = useState(1)
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

  const loadOwnerVideos = useCallback(async () => {
    if (!ownerId || isLoadingOwner || !hasMoreOwner) return

    setIsLoadingOwner(true)
    try {
      const response = await fetch(
        `/api/owner-videos?ownerId=${encodeURIComponent(ownerId)}&excludeId=${encodeURIComponent(currentVideoDbId || '')}&page=${ownerPage}&limit=10&safeOnly=1`
      )

      if (!response.ok) {
        setHasMoreOwner(false)
        return
      }

      const result = await response.json()

      if (result.data && result.data.length > 0) {
        const filtered = result.data.filter(
          (video: FileType) =>
            video.unique_id !== currentVideoId && !isMarkedAdult(video.is_adult)
        )
        if (filtered.length > 0) {
          setOwnerVideos(prev => [...prev, ...filtered])
          setOwnerPage(prev => prev + 1)
          setHasMoreOwner(result.pagination?.hasMore || false)
        } else {
          setHasMoreOwner(false)
        }

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
        setHasMoreOwner(false)
      }
    } catch (error) {
      console.error("Error loading owner videos:", error)
      setHasMoreOwner(false)
    } finally {
      setIsLoadingOwner(false)
    }
  }, [ownerId, isLoadingOwner, hasMoreOwner, ownerPage, currentVideoId, currentVideoDbId])

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
  }, [isLoading, hasMore, currentVideoId, currentVideoDbId, displayVideos])

  useEffect(() => {
    if (ownerId && ownerVideos.length === 0 && !isLoadingOwner) {
      const loadInitial = async () => {
        setIsLoadingOwner(true)
        try {
          const response = await fetch(
            `/api/owner-videos?ownerId=${encodeURIComponent(ownerId)}&excludeId=${encodeURIComponent(currentVideoDbId || '')}&page=1&limit=10&safeOnly=1`
          )
          if (response.ok) {
            const result = await response.json()
            if (result.data && result.data.length > 0) {
              const filtered = result.data.filter(
                (video: FileType) =>
                  video.unique_id !== currentVideoId && !isMarkedAdult(video.is_adult)
              )
              if (filtered.length > 0) {
                setOwnerVideos(filtered)
                setOwnerPage(2)
                setHasMoreOwner(result.pagination?.hasMore || false)
              } else {
                setHasMoreOwner(false)
              }
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
              setHasMoreOwner(false)
            }
          } else {
            setHasMoreOwner(false)
          }
        } catch (error) {
          console.error("Error loading owner videos:", error)
          setHasMoreOwner(false)
        } finally {
          setIsLoadingOwner(false)
        }
      }
      loadInitial()
    }
  }, [ownerId, currentVideoDbId, currentVideoId])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading && activeTab === "upnext") {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (observerRef.current) {
      observer.observe(observerRef.current)
    }

    return () => observer.disconnect()
  }, [loadMore, hasMore, isLoading, activeTab])

  const value = useMemo(
    () => ({
      activeTab,
      setActiveTab,
      displayVideos,
      setDisplayVideos,
      ownerVideos,
      setOwnerVideos,
      isLoading,
      setIsLoading,
      isLoadingOwner,
      setIsLoadingOwner,
      hasMore,
      setHasMore,
      hasMoreOwner,
      setHasMoreOwner,
      ownerPage,
      setOwnerPage,
      observerRef,
      userActions,
      setUserActions,
      loadMore,
      loadOwnerVideos
    }),
    [
      activeTab,
      displayVideos,
      ownerVideos,
      isLoading,
      isLoadingOwner,
      hasMore,
      hasMoreOwner,
      ownerPage,
      userActions,
      loadMore,
      loadOwnerVideos
    ]
  )

  return <RelatedVideosContext.Provider value={value}>{children}</RelatedVideosContext.Provider>
}
