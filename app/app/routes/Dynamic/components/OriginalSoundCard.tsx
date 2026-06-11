import { Music2 } from "lucide-react";
import { Link } from "react-router";
import WatchLink from "~/components/WatchLink";
import { getThumbnailUrl, cn } from "~/lib/utils";
import type { DynamicDeferredDetails } from "../index";

/**
 * YouTube-style "Music" section inside the description card: shown when this
 * file's audio fingerprint matched an existing upload. Big heading, the
 * original's art + title + creator (clickable through to it), and a "Music"
 * pill that opens the sound page with every video using it.
 */
export default function OriginalSoundCard({
  originalSound,
}: {
  originalSound: NonNullable<DynamicDeferredDetails["originalSound"]>;
}) {
  const title =
    originalSound.file_title?.trim() ||
    (originalSound.filename || "").replace(/\.[^./\\]+$/, "") ||
    "Original content";

  const thumbnail = originalSound.created_at
    ? getThumbnailUrl(
        {
          default_thumbnail: originalSound.default_thumbnail,
          thumbnails: originalSound.thumbnails,
          created_at: originalSound.created_at,
          unique_id: originalSound.unique_id,
          filename: originalSound.filename || "",
        },
        { queryString: "?quality=50" },
      )
    : null;

  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <h3 className="text-lg font-bold text-foreground">Music</h3>
      <p className="mb-3 text-xs text-muted-foreground">1 song</p>

      <WatchLink
        to={`/${encodeURIComponent(originalSound.unique_id)}`}
        className={cn(
          "group flex items-center gap-4 rounded-xl p-1 transition-colors hover:bg-accent/40",
        )}
      >
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:h-28 sm:w-28">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Music2 className="h-7 w-7" aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold text-foreground group-hover:underline sm:text-base">
            {title}
          </p>
          {originalSound.ownerUsername && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {originalSound.ownerUsername}
            </p>
          )}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Original content</p>
        </div>
      </WatchLink>

      <Link
        to={`/music/${encodeURIComponent(originalSound.id)}`}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-border/70 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 sm:max-w-md"
      >
        <Music2 className="h-4 w-4" aria-hidden />
        Music
      </Link>
    </div>
  );
}
