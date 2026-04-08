import { RelatedVideosProvider, useRelatedVideosContext } from "./RelatedVideosContext"
import VideoCard from "~/routes/Home/components/VideoCard"
import { Button } from "~/components/ui/button"
import type { FileType } from "~/lib/types"
import { SignInToSeeMore } from "~/components/SignInWall"

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
    activeTab,
    setActiveTab,
    displayVideos,
    ownerVideos,
    isLoading,
    isLoadingOwner,
    hasMore,
    hasMoreOwner,
    observerRef,
    userActions,
    loadMore,
    loadOwnerVideos
  } = useRelatedVideosContext()

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab("upnext")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            activeTab === "upnext"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Up next
        </button>
        {ownerVideos.length > 0 && (
          <button
            onClick={() => setActiveTab("creator")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === "creator"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            More from creator
          </button>
        )}
      </div>

      {activeTab === "upnext" && (
        <div className="space-y-4">
          {displayVideos.length === 0 && !isLoading ? (
            <div className="flex items-center justify-center p-8">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">No related videos available</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2">
                {displayVideos.map((video, index) => (
                  <VideoCard layout={`horizontal`} related={true} key={video.unique_id} data={video} index={index} currentUserId={currentUserId} userActions={userActions} />
                ))}
              </div>
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
      )}

      {activeTab === "creator" && (
        <div className="space-y-4">
          {ownerVideos.length === 0 && isLoadingOwner ? (
            <div className="flex items-center justify-center p-8">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            </div>
          ) : ownerVideos.length === 0 ? (
            <div className="flex items-center justify-center p-8">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">No videos from this creator</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2">
                {ownerVideos.map((video, index) => (
                  <VideoCard layout={`horizontal`} key={video.unique_id} data={video} index={index} currentUserId={currentUserId} userActions={userActions} />
                ))}
              </div>
              {hasMoreOwner && (
                currentUserId ? (
                  <div className="flex items-center justify-center pt-4">
                    <Button
                      onClick={loadOwnerVideos}
                      disabled={isLoadingOwner}
                      variant="outline"
                      className="w-full sm:w-auto"
                    >
                      {isLoadingOwner ? (
                        <>
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                          Loading...
                        </>
                      ) : (
                        "Load More"
                      )}
                    </Button>
                  </div>
                ) : (
                  <SignInToSeeMore />
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
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
