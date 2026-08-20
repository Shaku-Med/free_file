import { RelatedVideosProvider, useRelatedVideosContext } from "./RelatedVideosContext"
import VideoCard from "~/routes/Home/components/VideoCard"
import type { FileType } from "~/lib/types"
import { SignInToSeeMore } from "~/components/SignInWall"
import RelatedVideosSkeleton, { RelatedVideosLoadingAnnouncement } from "./RelatedVideosSkeleton"
import { cn, getThumbnailUrl, displayMediaTitle } from "~/lib/utils"
import { BASE_URL } from "~/lib/URLS"
import ParseFilenameInsert from "~/lib/utils/ShowFileName"
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters"
import { Carousel, CarouselItem } from "~/components/Carousel/Carousel"

interface RelatedVideosProps {
  videos: FileType[]
  currentVideoId: string
  currentVideoDbId?: string
  ownerId?: string
  currentUserId?: string
  currentFileType?: string
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> }
}

const RelatedVideosContent = ({ currentUserId }: { currentUserId?: string }) => {
  const {
    displayVideos,
    isLoading,
    hasMore,
    observerRef,
    userActions,
  } = useRelatedVideosContext()

  const relatedToShow = displayVideos

  const relatedGridClass =
    "grid min-w-0 grid-cols-1 gap-2 @min-[480px]/related-videos:grid-cols-2 @min-[900px]/related-videos:grid-cols-3"

  const renderVideoCard = (video: FileType, index: number) => (
    <VideoCard
      related
      hideActions={{completely: false, halfway: true}}
      key={video.unique_id}
      data={video}
      index={index}
      currentUserId={currentUserId}
      userActions={userActions}
      layout={`horizontal`}
    />
  )

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
              // overflow stays visible here, the carousel clips itself
              className="col-span-full w-full min-w-0 max-w-full overflow-visible"
            >
              <Carousel label="Reels" itemWidth={150} gapClassName="gap-2">
                {group.files.map((file, keyIndex) => {
                  const index = indexCounter++
                  return (
                    <CarouselItem key={file.id || file.unique_id || keyIndex}>
                      <VideoCard
                        data={file}
                        layout="reelStrip"
                        related
                        index={index}
                        currentUserId={currentUserId}
                        userActions={userActions}
                        hideActions={{ completely: false, halfway: true }}
                      />
                    </CarouselItem>
                  )
                })}
              </Carousel>
            </div>
          )
        })}
      </div>
    )
  }

  // An empty rail is only genuinely empty once the API has said so. hasMore
  // starts true and only flips false when a fetch returns no next cursor.
  // Signed-out viewers never mount the sentinel, so they can't be "awaiting"
  // anything: for them empty means empty.
  const awaitingFirstPage =
    relatedToShow.length === 0 && hasMore && Boolean(currentUserId)

  const inner = (
    <div className="@container/related-videos min-w-0 space-y-3 sm:space-y-4">
{/* No sidebar queue panel: the drag-to-reorder "Play queue" was removed
          (YouTube has no such feature), and Mix is deferred (docs/Mix.md). The
          sidebar is related videos only. */}

      <div className="space-y-4">
        {/* Empty is only EMPTY once the API has said so. hasMore starts true and
            flips to false when a fetch comes back with no next cursor, so an
            empty list with hasMore still set just means the first page hasn't
            landed. Showing "no related videos" there was wrong twice over: it
            claimed a result nobody had, and the observer sentinel below lives
            in the other branch, so it never mounted and loadMore could never
            fire. The rail stayed empty forever. */}
        {awaitingFirstPage ? (
          <>
            <RelatedVideosLoadingAnnouncement />
            <RelatedVideosSkeleton />
            {/* Sentinel has to be inside this branch too, otherwise the very
                case that needs a fetch is the one that can't trigger one. */}
            <div ref={observerRef} className="h-10" />
          </>
        ) : relatedToShow.length === 0 ? (
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

  return inner
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
