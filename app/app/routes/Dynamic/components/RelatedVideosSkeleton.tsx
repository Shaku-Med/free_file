import { Skeleton } from "~/components/ui/skeleton"

/**
 * Placeholder for the related rail while the first page is in flight.
 *
 * Geometry is copied from VideoCard's `horizontal` layout, which is what the
 * rail actually renders: landscape thumb on the left at w-[46%], two-line title
 * beside it, same gap-3 / rounded-lg / p-2 shell and the same container-query
 * grid. A placeholder that doesn't match just moves the reflow to when the data
 * lands. Mobile stacks the same way the real card does.
 */

/** Slight width variation so the rail doesn't read as a printed pattern. */
const TITLE_WIDTHS = ["w-[94%]", "w-[80%]", "w-[88%]", "w-[72%]", "w-[90%]", "w-[76%]"]

export default function RelatedVideosSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-2 @min-[480px]/related-videos:grid-cols-2 @min-[900px]/related-videos:grid-cols-3"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg p-1.5 sm:flex-row sm:items-start sm:gap-3 sm:p-2"
        >
          <Skeleton className="aspect-video w-full shrink-0 rounded-xl sm:w-[46%] sm:min-w-40 sm:max-w-80 sm:rounded-lg" />

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 py-0.5">
            {/* Title runs to two lines in the real card. */}
            <Skeleton className={`h-3.5 ${TITLE_WIDTHS[i % TITLE_WIDTHS.length]}`} />
            <Skeleton className="h-3.5 w-[55%]" />
            {/* Channel, then views and age. */}
            <Skeleton className="mt-0.5 h-3 w-[42%]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Screen-reader counterpart: the grid above is decorative. */
export function RelatedVideosLoadingAnnouncement() {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      Loading related videos
    </span>
  )
}
