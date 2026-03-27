import { Link } from "react-router";
import { Tv2, PlayCircle, Check } from "lucide-react";
import { getThumbnailUrl } from "~/lib/utils";
import type { SeriesData, SeriesEpisode } from "../index";

interface Props {
  series: SeriesData;
  currentFileId: string;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function episodeLabel(ep: SeriesEpisode): string {
  if (ep.is_series_main) return "Main";
  if (ep.season_number && ep.episode_number) return `S${ep.season_number}E${ep.episode_number}`;
  if (ep.episode_number) return `Ep ${ep.episode_number}`;
  return "";
}

export default function SeriesPanel({ series, currentFileId }: Props) {
  // Group: main first, then by season/episode order (already ordered by SQL)
  const episodes = series.episodes;

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden mb-4">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border/50 bg-muted/30">
        <Tv2 className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{series.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {episodes.length} {episodes.length === 1 ? "episode" : "episodes"}
          </p>
        </div>
      </div>

      {/* Episode list */}
      <div className="max-h-[420px] overflow-y-auto divide-y divide-border/30">
        {episodes.map((ep) => {
          const isCurrent = ep.id === currentFileId;
          const thumb = getThumbnailUrl({
            default_thumbnail: ep.default_thumbnail,
            file_type: ep.file_type,
            endpoint: ep.endpoint,
            created_at: ep.file_created_at,
            unique_id: ep.unique_id,
            filename: ep.unique_id,
          });
          const label = episodeLabel(ep);
          const title = ep.file_title?.trim() || ep.unique_id;

          return (
            <Link
              key={ep.id}
              to={`/${ep.unique_id}`}
              className={`flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-accent/50 ${
                isCurrent ? "bg-primary/8" : ""
              }`}
            >
              {/* Thumbnail */}
              <div className="relative w-16 aspect-video rounded-md overflow-hidden bg-muted shrink-0">
                <img
                  src={thumb}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {ep.duration && (
                  <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[9px] font-medium px-1 rounded">
                    {formatDuration(ep.duration)}
                  </span>
                )}
                {isCurrent && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <PlayCircle className="w-5 h-5 text-white" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                {label && (
                  <span className="inline-block text-[10px] font-semibold text-primary bg-primary/10 rounded-full px-1.5 py-0.5 mb-0.5">
                    {label}
                  </span>
                )}
                <p
                  className={`text-xs leading-snug line-clamp-2 ${
                    isCurrent ? "text-primary font-medium" : "text-foreground"
                  }`}
                >
                  {title}
                </p>
              </div>

              {/* Playing indicator */}
              {isCurrent && (
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
