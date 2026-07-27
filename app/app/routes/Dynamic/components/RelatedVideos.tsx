import { useState, type ComponentProps } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { RelatedVideosProvider, useRelatedVideosContext } from "./RelatedVideosContext"
import VideoCard from "~/routes/Home/components/VideoCard"
import type { FileType } from "~/lib/types"
import { SignInToSeeMore } from "~/components/SignInWall"
import { MixPanel } from "./MixPanel"
import {
  PLAY_QUEUE_DROP_APPEND,
  PLAY_QUEUE_DROP_EMPTY,
  playQueueItemId,
  relatedVideoDragId,
  usePlayQueueOptional,
} from "./PlayQueueContext"
import { cn, getThumbnailUrl, displayMediaTitle } from "~/lib/utils"
import { BASE_URL } from "~/lib/URLS"
import ParseFilenameInsert from "~/lib/utils/ShowFileName"
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters"
import { Swiper, SwiperSlide } from "swiper/react"
import { Navigation, A11y, Keyboard } from "swiper/modules"
import type { Swiper as SwiperType } from "swiper"
import "swiper/css"
import "swiper/css/navigation"

interface RelatedVideosProps {
  videos: FileType[]
  currentVideoId: string
  currentVideoDbId?: string
  ownerId?: string
  currentUserId?: string
  currentFileType?: string
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> }
}

function DraggableQueueVideoCard(props: ComponentProps<typeof VideoCard>) {
  const { data } = props
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: relatedVideoDragId(data.id),
    data: { video: data },
  })
  return (
    <div
      ref={setNodeRef}
      className={cn("h-full min-w-0 rounded-xl", isDragging && "opacity-50")}
      {...listeners}
      {...attributes}
    >
      <VideoCard {...props} />
    </div>
  )
}

const RelatedVideosContent = ({ currentUserId }: { currentUserId?: string }) => {
  const {
    displayVideos,
    isLoading,
    hasMore,
    observerRef,
    userActions,
  } = useRelatedVideosContext()

  const playQueue = usePlayQueueOptional()
  const addToPlayQueue = playQueue?.viewerCanCustomizeQueue
    ? (video: FileType) => playQueue.addToQueue(video)
    : undefined
  const isInPlayQueue = (id: string) => playQueue?.isInQueue(id) ?? false

  const [overlayVideo, setOverlayVideo] = useState<FileType | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    if (id.startsWith("related:")) {
      const v = e.active.data.current?.video as FileType | undefined
      setOverlayVideo(v ?? null)
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    setOverlayVideo(null)
    const { active, over } = e
    if (!playQueue) return
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)

    if (activeId.startsWith("queue:")) {
      if (overId === PLAY_QUEUE_DROP_APPEND) {
        const oldIndex = playQueue.queue.findIndex((v) => playQueueItemId(v.id) === activeId)
        if (oldIndex >= 0 && oldIndex !== playQueue.queue.length - 1) {
          playQueue.reorderQueue(oldIndex, playQueue.queue.length - 1)
        }
        return
      }
      if (overId.startsWith("queue:")) {
        const oldIndex = playQueue.queue.findIndex((v) => playQueueItemId(v.id) === activeId)
        const newIndex = playQueue.queue.findIndex((v) => playQueueItemId(v.id) === overId)
        if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
          playQueue.reorderQueue(oldIndex, newIndex)
        }
      }
      return
    }

    if (!activeId.startsWith("related:")) {
      return
    }

    const video = active.data.current?.video as FileType | undefined
    if (!video || video.unique_id === playQueue.currentUniqueId) return

    if (overId === PLAY_QUEUE_DROP_EMPTY) {
      playQueue.insertOrMoveAt(video, 0)
      return
    }
    if (overId === PLAY_QUEUE_DROP_APPEND) {
      playQueue.insertOrMoveAt(video, playQueue.queue.length)
      return
    }
    if (overId.startsWith("queue:")) {
      const overIndex = playQueue.queue.findIndex((v) => playQueueItemId(v.id) === overId)
      if (overIndex >= 0) playQueue.insertOrMoveAt(video, overIndex)
    }
  }

  const onDragCancel = () => setOverlayVideo(null)

  // Keep the related list DIFFERENT from the play queue (YouTube-style): drop
  // anything already sitting in the queue so the two sections never show the
  // same video twice.
  const queuedIds = new Set((playQueue?.queue ?? []).map((v) => v.id))
  const relatedToShow = displayVideos.filter((v) => !queuedIds.has(v.id))

  const relatedGridClass =
    "grid min-w-0 grid-cols-1 gap-2 @min-[480px]/related-videos:grid-cols-2 @min-[900px]/related-videos:grid-cols-3"

  // Reels never enter the play queue: no drag handle, no "add to queue".
  const renderVideoCard = (video: FileType, index: number) => {
    const queueable = !video.is_reel
    return queueable && playQueue?.viewerCanCustomizeQueue ? (
      <DraggableQueueVideoCard
        related
        hideActions={{completely: false, halfway: true}}
        key={video.unique_id}
        data={video}
        index={index}
        currentUserId={currentUserId}
        userActions={userActions}
        onAddToPlayQueue={addToPlayQueue}
        inPlayQueue={isInPlayQueue(video.id)}
        layout={`horizontal`}
      />
    ) : (
      <VideoCard
        related
        hideActions={{completely: false, halfway: true}}
        key={video.unique_id}
        data={video}
        index={index}
        currentUserId={currentUserId}
        userActions={userActions}
        onAddToPlayQueue={queueable ? addToPlayQueue : undefined}
        inPlayQueue={queueable ? isInPlayQueue(video.id) : false}
        layout={`horizontal`}
      />
    )
  }

  const renderGroupedVideos = (videos: FileType[], keyPrefix: string) => {
    const groups = groupConsecutiveReelClusters(videos)
    let indexCounter = 0
    return (
      <div className={relatedGridClass}>
        {groups.map((group) => {
          if (group.kind === "single") {
            const file = group.file
            const index = indexCounter++
            return renderVideoCard(file, index)
          }

          const clusterKey =
            group.files[0]?.feed_reel_cluster_id ?? group.files[0]?.id ?? keyPrefix

          return (
            <div
              key={`${keyPrefix}-reel-${clusterKey}`}
              className="col-span-full w-full min-w-0 max-w-full overflow-hidden"
            >
              <Swiper
                modules={[Navigation, A11y, Keyboard]}
                slidesPerView={2.15}
                spaceBetween={2}
                speed={380}
                watchOverflow
                observer
                observeParents
                resizeObserver
                navigation
                keyboard={{ enabled: true, onlyInViewport: true }}
                breakpoints={{
                  480: { slidesPerView: 2.2, spaceBetween: 2 },
                  768: { slidesPerView: 2.5, spaceBetween: 3 },
                  1024: { slidesPerView: 3, spaceBetween: 3 },
                  1280: { slidesPerView: 3.5, spaceBetween: 3 },
                }}
                className="feed-reel-swiper"
                onInit={(swiper: SwiperType) => {
                  swiper.update()
                }}
              >
                {group.files.map((file, keyIndex) => {
                  const index = indexCounter++
                  return (
                    <SwiperSlide key={file.id || file.unique_id || keyIndex} className="!h-auto">
                      <VideoCard
                        data={file}
                        layout="reelStrip"
                        related
                        index={index}
                        currentUserId={currentUserId}
                        userActions={userActions}
                        hideActions={{ completely: false, halfway: true }}
                      />
                    </SwiperSlide>
                  )
                })}
              </Swiper>
            </div>
          )
        })}
      </div>
    )
  }

  const inner = (
    <div className="@container/related-videos min-w-0 space-y-3 sm:space-y-4">
      {/* The drag-to-reorder "Play queue" panel is gone — YouTube has no such
          sidebar feature. When the URL carries ?list=RD… this shows that mix
          (and nothing otherwise, falling through to related videos). The queue
          CONTEXT still exists behind the scenes: it drives auto-advance for the
          player, series and PiP. */}
      <MixPanel currentUserId={currentUserId} />

      <div className="space-y-4">
        {relatedToShow.length === 0 && !isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">No related videos available</p>
            </div>
          </div>
        ) : (
          <>
            {renderGroupedVideos(relatedToShow, "upnext")}
            {hasMore && (
              currentUserId ? (
                <div ref={observerRef} className="h-10 flex items-center justify-center">
                  {isLoading && (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-sm text-muted-foreground">Loading more...</span>
                    </div>
                  )}
                </div>
              ) : (
                <SignInToSeeMore />
              )
            )}
          </>
        )}
      </div>
    </div>
  )

  if (!playQueue?.viewerCanCustomizeQueue) return inner

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {inner}
      <DragOverlay dropAnimation={null}>
        {overlayVideo ? (
          <div className="flex max-w-[min(100%,18rem)] items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-lg">
            <img
              src={getThumbnailUrl(overlayVideo, {
                baseUrl: BASE_URL,
                queryString: "?quality=60&is_metadata=true",
              })}
              alt=""
              className="h-12 w-20 shrink-0 rounded object-cover"
            />
            <span className="line-clamp-2 text-xs font-medium">
              <ParseFilenameInsert
                filename={displayMediaTitle(overlayVideo.file_title || overlayVideo.filename || "")}
                showLimit={42}
              />
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

const RelatedVideos = ({
  videos,
  currentVideoId,
  currentVideoDbId,
  ownerId,
  currentUserId,
  currentFileType,
  userActions: initialUserActions
}: RelatedVideosProps) => {
  return (
    <RelatedVideosProvider
      currentVideoId={currentVideoId}
      currentVideoDbId={currentVideoDbId}
      ownerId={ownerId}
      initialVideos={videos}
      initialUserActions={initialUserActions}
    >
      <RelatedVideosContent currentUserId={currentUserId} />
    </RelatedVideosProvider>
  )
}

export default RelatedVideos
