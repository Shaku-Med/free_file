import { Clapperboard } from "lucide-react";
import { Carousel, CarouselItem } from "~/components/Carousel/Carousel";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { cn } from "~/lib/utils";

/**
 * The labelled Shorts shelf and the grid skeletons, in one place.
 *
 * Four pages had grown their own copy of each: the feed, search, the playlist
 * view and the profile grid, with the shelf labelled "Shorts" in two of them
 * and "Reels" in another.
 */

type CardProps = React.ComponentProps<typeof VideoCard>;

interface ShelfCardProps {
  currentUserId?: string;
  userActions?: CardProps["userActions"];
  onUpdate?: CardProps["onUpdate"];
  hideActions?: CardProps["hideActions"];
  showOwnerControls?: CardProps["showOwnerControls"];
  profileOwnerUsername?: CardProps["profileOwnerUsername"];
}

export function ReelShelf({
  files,
  label = "Shorts",
  startIndex = 0,
  className,
  ...card
}: ShelfCardProps & {
  files: FileType[];
  label?: string;
  /** Keeps the running card index continuous with the grid around it. */
  startIndex?: number;
  className?: string;
}) {
  if (files.length === 0) return null;
  return (
    // overflow-visible: the carousel clips X itself; clipping here would cut
    // the hover scale and the arrow shadows.
    <div className={cn("col-span-full w-full min-w-0 max-w-full overflow-visible", className)}>
      <div className="mb-2 flex items-center gap-1.5">
        <Clapperboard className="h-5 w-5 text-foreground" aria-hidden />
        <h2 className="text-base font-semibold tracking-tight sm:text-lg">{label}</h2>
      </div>
      <Carousel label={label} itemWidth={168} gapClassName="gap-2.5">
        {files.map((file, i) => (
          <CarouselItem key={file.id || file.unique_id || i}>
            <VideoCard data={file} layout="reelStrip" index={startIndex + i} {...card} />
          </CarouselItem>
        ))}
      </Carousel>
    </div>
  );
}

/** Matches a default VideoCard: 16:9 poster, avatar, title, two meta lines. */
export function VideoCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video rounded-xl bg-muted" />
      <div className="mt-3 flex gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-[85%] rounded bg-muted" />
          <div className="h-3 w-[60%] rounded bg-muted" />
          <div className="h-3 w-[40%] rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

/** Poster, title, one meta line. For grids of lists rather than videos. */
export function PosterSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video rounded-xl bg-muted" />
      <div className="mt-2.5 h-4 w-3/4 rounded bg-muted" />
      <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
    </div>
  );
}

export function MediaGridSkeleton({
  count = 12,
  className,
  variant = "video",
}: {
  count?: number;
  className?: string;
  variant?: "video" | "poster";
}) {
  const Card = variant === "poster" ? PosterSkeleton : VideoCardSkeleton;
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} />
      ))}
    </div>
  );
}
