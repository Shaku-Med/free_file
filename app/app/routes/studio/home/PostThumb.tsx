import { useCallback, useMemo, useState } from "react";
import { cn, displayMediaTitle, getThumbnailUrl } from "~/lib/utils";
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad";
import { formatTime } from "~/components/components/hlsplayer/controls/seek/functions/formatTime";
import type { DashPost } from "./dashboardTypes";

export function postTitle(post: Pick<DashPost, "file_title" | "filename">): string {
  return displayMediaTitle(post.file_title?.trim() || post.filename);
}

export function postAnalyticsHref(post: Pick<DashPost, "unique_id">): string {
  return `/brozystudio/post/${encodeURIComponent(post.unique_id)}`;
}

/**
 * Goes through ImageLoad like every other thumbnail: adult posts need the load
 * token, which a bare <img> never sends, so their thumbnails would 403.
 */
export function PostThumb({
  post,
  className,
  showDuration = false,
}: {
  post: DashPost;
  className?: string;
  showDuration?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const link = useMemo(() => getThumbnailUrl(post, { retryAttempt: attempt }), [post, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const seconds = Number(post.duration) || 0;

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      <ImageLoad
        link={link}
        imageID={post.unique_id}
        retry={retry}
        quality={60}
        hasAdultTag={post.is_adult}
        className="h-full w-full object-cover"
      />
      {showDuration && seconds > 0 && (
        <span className="absolute bottom-1.5 right-1.5 z-[3] rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground backdrop-blur-sm">
          {formatTime(seconds)}
        </span>
      )}
    </div>
  );
}
