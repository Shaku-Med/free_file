import { useState, useEffect, useRef, useCallback } from "react";
import DateSection from "./components/DateSection";
import SelectionToolbar from "./components/SelectionToolbar";
import { useFileContext } from "~/lib/Context/Context";
import VideoCard from "./components/VideoCard";
import type { FileType } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";

export default function PhotoDashboard() {
  const { files, setIsModalOpen, setFiles } = useFileContext();
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<HTMLDivElement>(null)
  const [currentPage, setCurrentPage] = useState(1);

  const loadMoreVideos = useCallback(async () => {
    if (isLoading || !hasMore) return

    setIsLoading(true)
    try {
      const nextPage = currentPage + 1
      try {
        let response = await fetch(`/api/get/?page=${nextPage}&currentPage=${currentPage}`)
        if(!response.ok) {
            setHasMore(false)
            return
        }
        let data = await response.json()
        if (data?.data) {
          setFiles((prev: FileType[]) => [...prev, ...data.data])
        }
        setCurrentPage(data.pagination.page)
        setHasMore(data.pagination.nextPage < data.pagination.totalPages)
      }
      catch (error) {
        console.log(`Error Found In loadMoreVideos: `, error)
      }
    } finally {
      setIsLoading(false)
    }
  }, [currentPage, isLoading, hasMore])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMoreVideos()
        }
      },
      { threshold: 0.1 }
    )
    if (observerRef.current) observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [loadMoreVideos, hasMore, isLoading])

  return (
    <div className="">
      <div className="mx-auto px-6 xl:px-8 max-w-full xl:container py-8">
      
      {
        files.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-5 gap-2 p-4">
                  {files.map((file, index) => (
                    <VideoCard key={index || 0} data={file as FileType} />
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
            </>
        ) : (
          <>

            <div className="flex items-center flex-col justify-center min-h-screen bg-background">
              <div className="text-center">
                <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
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
            </div>
          </>
        )
      }

      </div>
    </div>
  );
}