import type { CSSProperties } from "react";
import { Clapperboard, Image as ImageIcon, Play } from "lucide-react";
import { Link } from "react-router-dom";
import type { MediaItem } from "@/data/mock";

function thumbStyle(hue: number): CSSProperties {
  return {
    background: `
      linear-gradient(145deg, hsla(${hue}, 70%, 55%, 0.35), transparent 55%),
      linear-gradient(320deg, hsla(${(hue + 40) % 360}, 65%, 45%, 0.25), transparent 50%),
      #1c2230
    `,
  };
}

export function MediaCard({ item }: { item: MediaItem }) {
  return (
    <Link to={`/watch/${item.id}`} className="group block min-w-0">
      <div
        className="relative aspect-video overflow-hidden rounded-xl border border-border/70 ring-1 ring-white/5 transition group-hover:border-primary/40"
        style={thumbStyle(item.hue)}
      >
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <div className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
            <Play className="size-5 fill-current" />
          </div>
        </div>

        {item.kind === "reel" ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            <Clapperboard className="size-3" />
            Reel
          </span>
        ) : null}
        {item.kind === "image" ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            <ImageIcon className="size-3" />
            Photo
          </span>
        ) : null}
        {item.duration ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
            {item.duration}
          </span>
        ) : null}
        {typeof item.progress === "number" ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <div className="h-full bg-primary" style={{ width: `${item.progress * 100}%` }} />
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 min-w-0">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition group-hover:text-primary">
          {item.title}
        </h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">@{item.creator}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.views} views · {item.age}
        </p>
      </div>
    </Link>
  );
}

export function CompactRow({ item }: { item: MediaItem }) {
  return (
    <Link
      to={`/watch/${item.id}`}
      className="group flex items-start gap-3 rounded-xl p-2 transition hover:bg-muted/50"
    >
      <div
        className="relative aspect-video w-[9.5rem] shrink-0 overflow-hidden rounded-lg border border-border"
        style={thumbStyle(item.hue)}
      >
        {item.duration ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-px text-[9px] font-semibold text-white">
            {item.duration}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground group-hover:text-primary">
          {item.title}
        </h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">@{item.creator}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.views} views · {item.age}
        </p>
      </div>
    </Link>
  );
}
