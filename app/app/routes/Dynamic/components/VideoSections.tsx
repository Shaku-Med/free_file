import { useEffect, useState, type RefObject } from "react";
import { Carousel, CarouselItem } from "~/components/Carousel/Carousel";
import { dispatchSeekTo } from "~/components/FormattedText";
import {
  activeChapterIndex,
  type Chapter,
} from "~/components/components/hlsplayer/controls/seek/functions/parseChapters";
import { formatTime } from "~/components/components/hlsplayer/controls/seek/functions/formatTime";
import { cn } from "~/lib/utils";

// The sections from the description as a row you can jump through, with the one
// currently playing highlighted. Uses the same seek event as description links.
export default function VideoSections({
  chapters,
  fileId,
  videoRef,
  videoReady,
}: {
  chapters: Chapter[];
  fileId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoReady: boolean;
}) {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const video = videoRef.current;
    if (!videoReady || !video) return;
    const update = () => setActive(activeChapterIndex(chapters, video.currentTime));
    update();
    video.addEventListener("timeupdate", update);
    video.addEventListener("seeked", update);
    return () => {
      video.removeEventListener("timeupdate", update);
      video.removeEventListener("seeked", update);
    };
  }, [chapters, videoRef, videoReady]);

  if (chapters.length === 0) return null;

  return (
    <section aria-label="Sections" className="mt-4 border-t border-border/60 pt-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">Sections</h3>
        <span className="text-xs text-muted-foreground">{chapters.length} sections</span>
      </div>
      <Carousel label="Sections" itemWidth={208} gapClassName="gap-2">
        {chapters.map((chapter, i) => (
          <CarouselItem key={chapter.start}>
            <button
              type="button"
              onClick={() => dispatchSeekTo({ seconds: chapter.start, fileId })}
              aria-current={i === active ? "true" : undefined}
              className={cn(
                "flex h-full w-full flex-col items-start gap-1 rounded-lg border border-border/60 px-3 py-2.5 text-left transition-colors",
                "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                i === active && "bg-accent",
              )}
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                {i + 1} · {formatTime(chapter.start)}
              </span>
              <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                {chapter.title}
              </span>
            </button>
          </CarouselItem>
        ))}
      </Carousel>
    </section>
  );
}
