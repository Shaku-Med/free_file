import { Link } from "react-router";
import { ListVideo } from "lucide-react";
import { cn, getThumbnailUrl, displayMediaTitle } from "~/lib/utils";
import { mixWatchPath } from "~/lib/music/mixId";
import type { FileType } from "~/lib/types";

/**
 * Mix card — the feed's entry point into a generated mix.
 *
 * Modelled on YouTube's mix tile and intentionally NOT a normal video card:
 *   - the poster is the FIRST track of the mix
 *   - it links to that track's watch page carrying `?list=<gid>`, so the video
 *     plays immediately and the sidebar becomes the queue (a mix has no page
 *     of its own to land on)
 *   - NO avatar and NO uploader name: a mix belongs to no one. It's generated,
 *     shareable, and works for signed-out viewers.
 *
 * Spacing/typography deliberately mirror the default VideoCard so it blends
 * into the grid instead of looking like a special case.
 */

export interface MixCardData {
  /** Shareable list id (RD…). */
  gid: string;
  /** First track — supplies the poster, the title and the watch URL. */
  firstItem: FileType;
  /** Total tracks in the mix, for the badge. */
  count?: number;
  /** Optional override, e.g. "Mix - Fireboy DML". */
  title?: string;
}

export default function MixCard({
  mix,
  className,
}: {
  mix: MixCardData;
  className?: string;
}) {
  const { gid, firstItem, count } = mix;
  if (!gid || !firstItem?.unique_id) return null;

  // start_radio=1: opening a mix from the feed means "play this mix", which is
  // exactly what YouTube marks with this param.
  const href = mixWatchPath(String(firstItem.unique_id), gid, true);
  const thumb = getThumbnailUrl(firstItem as never, {});
  const baseTitle =
    mix.title ??
    `Mix - ${displayMediaTitle(firstItem.file_title || firstItem.filename || "")}`;

  return (
    <div className={cn("item group relative flex h-full flex-col", className)}>
      <Link
        to={href}
        className="relative block"
        aria-label={`${baseTitle}, mix of ${count ?? "several"} tracks`}
      >
        {/* Stacked depth — same treatment the series cover uses, so a
            collection reads as a collection. Pointer events off so they can
            never swallow the click. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-1 -top-1 z-0 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] translate-x-1.5 -translate-y-1 rounded-lg bg-card/90 ring-1 ring-border/40 shadow-sm dark:bg-zinc-800/80 dark:ring-white/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-0.5 -top-0.5 z-0 h-[calc(100%-0.25rem)] w-[calc(100%-0.25rem)] translate-x-0.5 -translate-y-0.5 rounded-lg bg-card ring-1 ring-border/50 shadow dark:bg-zinc-900 dark:ring-white/10"
        />

        <div className="relative z-[10] aspect-video w-full overflow-hidden rounded-xl bg-muted">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ListVideo className="h-8 w-8" />
            </div>
          )}

          {/* Bottom-right "Mix" pill, matching where a duration badge sits. */}
          <span className="pointer-events-none absolute bottom-2 right-2 z-20 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white shadow-sm backdrop-blur-sm">
            <ListVideo className="h-3.5 w-3.5" />
            Mix
          </span>
        </div>
      </Link>

      {/* No avatar column here — unlike a video card, a mix has no owner. */}
      <div className="z-[20] mt-3 flex flex-col">
        <Link to={href} className="min-w-0 hover:text-primary transition-colors">
          <h3 className="line-clamp-2 break-words text-[0.9375rem] font-medium leading-[1.35] md:text-base">
            {baseTitle}
          </h3>
        </Link>
        <div className="mt-1 flex min-h-[1.25rem] flex-wrap items-center gap-x-1 text-[0.8125rem] text-muted-foreground">
          <span>Mix</span>
          {typeof count === "number" && count > 0 && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span>{count} tracks</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
