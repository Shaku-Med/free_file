import { Music2 } from "lucide-react";
import { getThumbnailUrl } from "~/lib/utils";
import type { DynamicDeferredDetails } from "../types";

/**
 * YouTube-style "Music" block for AcoustID / MusicBrainz matches.
 * Cover uses the same /api/load/image pipeline as other thumbnails.
 */
export default function AcoustidRecordingCard({
  recording,
  host,
}: {
  recording: NonNullable<DynamicDeferredDetails["acoustidRecording"]>;
  host: { unique_id: string; created_at?: string | null };
}) {
  const title = recording.title?.trim() || "";
  const artists = recording.artists?.trim() || "";
  const album = recording.album?.trim() || null;
  // No usable song identity ⇒ render nothing (loader should already filter these).
  if (
    !title ||
    !artists ||
    /^unknown title$/i.test(title) ||
    /^unknown artist$/i.test(artists) ||
    /matched,\s*but musicbrainz/i.test(title)
  ) {
    return null;
  }

  const coverPath = recording.cover_art_url?.trim() || "";
  const thumbnail = coverPath
    ? getThumbnailUrl(
        {
          default_thumbnail: coverPath,
          thumbnails: [coverPath],
          created_at: host.created_at || "",
          unique_id: host.unique_id,
          filename: "acoustid_cover.jpg",
        },
        { queryString: "?quality=70" },
      )
    : null;

  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <h3 className="text-lg font-bold text-foreground">Music</h3>
      <p className="mb-3 text-xs text-muted-foreground">Identified song</p>

      <div className="flex items-center gap-4">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:h-28 sm:w-28">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Music2 className="h-7 w-7" aria-hidden />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold text-foreground sm:text-base">
            {title}
          </p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{artists}</p>
          {album && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{album}</p>
          )}
        </div>
      </div>
    </div>
  );
}
