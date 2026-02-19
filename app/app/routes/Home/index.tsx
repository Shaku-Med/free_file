import { useFileContext } from "~/lib/Context/Context";
import VideoCard from "./components/VideoCard";
import type { FileType } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Memories – Your feed of photos and videos",
    description:
      "Discover and watch photos and videos on your personalized feed. Upload your own, like, comment, and share with the Memories community.",
    canonicalPath: "/",
  });

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video bg-muted rounded-xl" />
      <div className="flex gap-3 mt-3">
        <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-[85%]" />
          <div className="h-3 bg-muted rounded w-[60%]" />
          <div className="h-3 bg-muted rounded w-[40%]" />
        </div>
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
      {Array.from({ length: 12 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export default function PhotoDashboard() {
  const { files, setIsModalOpen, observerRef, isLoading, initialLoading, userId, userActions, clearFeedHistory } = useFileContext();

  if (initialLoading) {
    return (
      <div className="">
        <div className="mx-auto max-w-full xl:container py-8">
          <FeedSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="">
      <div className="mx-auto max-w-full xl:container py-8">
      {files.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
            {files.map((file, index) => (
              <VideoCard key={file.id || index} data={file as FileType} index={index} currentUserId={userId || undefined} userActions={userActions} />
            ))}
          </div>
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 mt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={`skeleton-${i}`} />
              ))}
            </div>
          )}
          <div ref={observerRef} className="h-10" />
        </>
      ) : (
        <div className="flex items-center flex-col justify-center min-h-full bg-background">
          <div className="text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          {userId ? (
            <>
              <h2 className="text-2xl font-semibold text-foreground mb-2">You're all caught up</h2>
              <p className="text-muted-foreground mb-6">Your feed only shows content you haven't seen yet. Reset feed to see everything again.</p>
              <Button
                onClick={() => clearFeedHistory()}
                variant="default"
                className="rounded-full px-8 py-3 font-medium shadow-lg"
              >
                Reset feed
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold text-foreground mb-2">No Media Found</h2>
              <p className="text-muted-foreground mb-6">Upload some files to get started</p>
              <Button
                onClick={() => setIsModalOpen(true)}
                variant="default"
                className="rounded-full px-8 py-3 font-medium shadow-lg"
              >
                <Plus className="w-5 h-5 mr-2" />
                Add Media
              </Button>
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}