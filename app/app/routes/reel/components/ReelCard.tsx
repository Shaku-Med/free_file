import { Play, Pause, Volume2, VolumeX, MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import CommentSection from "~/routes/Dynamic/components/Comments/CommentSection";
import UserAction from "~/routes/components/UserAction";
import HLSPlayer from "~/components/components/hlsplayer";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import type { FileType } from "~/lib/types";
import { getVideoSrc, ParseFilename } from "~/lib/utils";
import { useFileContext } from "~/lib/Context/Context";

export const ReelCard = ({ data }: { data: FileType }) => {
  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playPauseIndicator, setPlayPauseIndicator] = useState<"play" | "pause" | null>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [likeCount, setLikeCount] = useState<number>(Number((data as any).up_count || 0));
  const [dislikeCount, setDislikeCount] = useState<number>(Number((data as any).down_count || 0));
  const [commentsCount, setCommentsCount] = useState<number | null>(
    typeof (data as any).comments_count === "number" ? Number((data as any).comments_count) : null
  );
  const [initialMetaLoaded, setInitialMetaLoaded] = useState(false);
  const [initialLiked, setInitialLiked] = useState(false);
  const [initialDisliked, setInitialDisliked] = useState(false);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indicatorTimeoutRef = useRef<number | null>(null);
  const isInView = useInView(containerRef, { amount: 0.6 });
  const { c_user } = useFileContext();

  const isHls =
    data.file_type === "application/vnd.apple.mpegurl" ||
    (data.endpoint ?? "").includes(".m3u8");
  const isVideoType =
    data.file_type?.toLowerCase().startsWith("video/") || isHls;
  const isVideoLikeFile = Boolean(isVideoType);
  const videoSrc = isVideoLikeFile
    ? getVideoSrc(data.endpoint ?? "", data.file_type)
    : undefined;

  const toggleMute = () => setMuted((prev) => !prev);

  // Control playback based on whether this reel is actually in view
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;

    video.muted = false
    if (isInView) {
      // using the windows history stuff let's change the url to the dynamic reel route
      window.history.pushState(null, "", `/reel/${data.id}`);
      // Update the browser tab title for the current reel
      window.document.title = `${data.file_title || ParseFilename(data.filename)} - Memories`;
      video
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => undefined);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [isInView, data.file_title, data.filename, data.id]);

  // When the reel first comes into view, fetch fresh like/dislike state and comment count.
  useEffect(() => {
    if (!isInView || initialMetaLoaded === true) return;

    let cancelled = false;

    const fetchMeta = async () => {
      try {
        const [likeRes, dislikeRes, commentsRes] = await Promise.all([
          fetch(`/api/likes?fileId=${encodeURIComponent(data.id)}`).catch(() => null),
          fetch(`/api/dislikes?fileId=${encodeURIComponent(data.id)}`).catch(() => null),
          fetch(`/api/comments?fileId=${encodeURIComponent(data.id)}&limit=50&offset=0`).catch(() => null),
        ]);

        let nextLiked = initialLiked;
        let nextDisliked = initialDisliked;
        let nextLikeCount = likeCount;
        let nextDislikeCount = dislikeCount;
        let nextCommentsCount = commentsCount;

        if (likeRes && likeRes.ok) {
          const json = await likeRes.json().catch(() => null);
          if (json) {
            if (typeof json.liked === "boolean") nextLiked = json.liked;
            if (typeof json.upCount === "number") nextLikeCount = json.upCount;
            if (typeof json.downCount === "number") nextDislikeCount = json.downCount;
          }
        }

        if (dislikeRes && dislikeRes.ok) {
          const json = await dislikeRes.json().catch(() => null);
          if (json) {
            if (typeof json.disliked === "boolean") nextDisliked = json.disliked;
            if (typeof json.upCount === "number") nextLikeCount = json.upCount;
            if (typeof json.downCount === "number") nextDislikeCount = json.downCount;
          }
        }

        if (commentsRes && commentsRes.ok) {
          const json = await commentsRes.json().catch(() => null);
          if (json && Array.isArray(json.data)) {
            nextCommentsCount = json.data.length;
          }
        }

        if (!cancelled) {
          setInitialLiked(nextLiked);
          setInitialDisliked(nextDisliked);
          setLikeCount(nextLikeCount);
          setDislikeCount(nextDislikeCount);
          setCommentsCount(nextCommentsCount ?? 0);
          setInitialMetaLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setInitialMetaLoaded(true);
        }
      }
    };

    void fetchMeta();

    return () => {
      cancelled = true;
    };
  }, [isInView, initialMetaLoaded, data.id, likeCount, dislikeCount, commentsCount, initialLiked, initialDisliked]);


  let handleCLickPausePlay = () => {
    const video = videoElementRef.current;
    if (!video) return;

    const shouldPlay = video.paused || video.ended;

    if (shouldPlay) {
      video.play().catch(() => undefined);
      video.muted = false
    } else {
      video.pause();
    }

    setIsPlaying(shouldPlay);
    setPlayPauseIndicator(shouldPlay ? "play" : "pause");

    if (indicatorTimeoutRef.current) {
      window.clearTimeout(indicatorTimeoutRef.current);
    }

    indicatorTimeoutRef.current = window.setTimeout(() => {
      setPlayPauseIndicator(null);
    }, 350);
  }

  return (
    <section className="reel-snap-item relative flex h-screen w-full items-center justify-center bg-black">
      <div
        ref={containerRef}
        className="relative h-full w-full reel_adjust px-0 sm:px-0 lg:py-2 py-0"
      >
        <article className="relative h-full w-full overflow-hidden bg-neutral-900 lg:rounded-2xl">
          {/* Actions / comments overlay above the player */}
          <aside className="pointer-events-auto absolute right-2 sm:right-4 bottom-10 sm:bottom-10 z-20">
            <div className="flex flex-col items-center gap-4 sm:gap-5 text-white">
              {/* If you want like/dislike in reels, uncomment and
                  wire these props from FileType / feed metadata. */}
              <UserAction
                isReel
                reelId={data.id}
                fileId={data.id}
                upCount={likeCount}
                downCount={dislikeCount}
                initialLiked={initialLiked}
                initialDisliked={initialDisliked}
                canDownload={false}
              />

              <Dialog open={isCommentsOpen} onOpenChange={setIsCommentsOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="flex flex-col items-center gap-1 text-white/90 hover:text-white"
                  >
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 shadow-md backdrop-blur-md sm:h-11 sm:w-11">
                      <MessageCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-medium tabular-nums">
                      {typeof commentsCount === "number"
                        ? commentsCount.toLocaleString("en-US")
                        : ""}
                    </span>
                  </button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-hidden p-0">
                  <div className="max-h-[80vh] overflow-y-auto px-4 py-3">
                    <CommentSection fileId={data.id} currentUserId={c_user || undefined || (null as unknown as string)} isReel={true} />
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </aside>

          <div
            className="w-full h-full video_container_reel relative cursor-pointer"
            onClick={handleCLickPausePlay}
          >
              {/* Player body */}
              {isVideoLikeFile && videoSrc && isInView ? (
                <HLSPlayer
                  src={videoSrc}
                  className="w-full h-full sm:rounded-none"
                  autoPlay={isInView}
                  muted={false}
                  loop
                  playsInline
                  imageID={data.unique_id}
                  file={data}
                  isReel
                  onVideoRef={(ref) => {
                    videoElementRef.current = ref;
                  }}
                />
              ) : (
                <>
                  {/* Simple thumbnail / play overlay fallback for non-video files */}
                  <div className="relative flex h-full flex-col justify-end p-3 sm:p-4">
                    <button
                      type="button"
                      onClick={toggleMute}
                      className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-md transition hover:bg-black/80"
                    >
                      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md">
                      <Play className="h-6 w-6 translate-x-[1px]" />
                    </div>
                  </div>
                </>
              )}

              {/* Center play / pause burst indicator (like YouTube) */}
              {isVideoLikeFile && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-[100000]">
                  {playPauseIndicator && (
                    <div className="reel-play-indicator flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white">
                      {playPauseIndicator === "play" ? (
                        <Play className="h-8 w-8 translate-x-[1px]" />
                      ) : (
                        <Pause className="h-8 w-8" />
                      )}
                    </div>
                  )}
                </div>
              )}
          </div>
        </article>

        <div className="absolute left-3 sm:left-4 bottom-10 sm:bottom-10 flex items-start flex-col gap-1 text-white z-[10]">
          {data.owner && (
            <div className="pointer-events-auto">
              <OwnerProfile
                owner={data.owner}
                size="sm"
                className="text-white/90 hover:text-white"
              />
            </div>
          )}
          <span className="text-muted-foreground text-xs line-clamp-1 bg-background px-1 py-1 rounded-lg break_text">
            {(data.file_title && data.file_title.trim() !== "")
              ? data.file_title
              : ParseFilename(data.filename)}
          </span>
        </div>
      </div>
    </section>
  );
};

