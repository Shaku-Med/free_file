import { Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { CompactRow } from "@/components/MediaCard";
import { FEED_ITEMS, RELATED } from "@/data/mock";

export function WatchPage() {
  const { id } = useParams();
  const item = FEED_ITEMS.find((f) => f.id === id) ?? FEED_ITEMS[0];

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <div
          className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black shadow-lg"
          style={{
            background: `
              linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.65)),
              linear-gradient(145deg, hsla(${item.hue}, 70%, 45%, 0.45), #0c0e12)
            `,
          }}
        >
          <div className="absolute inset-x-0 bottom-0 space-y-2 p-4">
            <div className="h-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full w-[38%] rounded-full bg-primary" />
            </div>
            <div className="flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-full bg-white/10 p-2 backdrop-blur">
                  <SkipBack className="size-4" />
                </button>
                <button type="button" className="rounded-full bg-primary p-2.5 text-primary-foreground">
                  <Pause className="size-4 fill-current" />
                </button>
                <button type="button" className="rounded-full bg-white/10 p-2 backdrop-blur">
                  <SkipForward className="size-4" />
                </button>
                <span className="ml-2 text-xs tabular-nums text-white/70">4:52 / {item.duration ?? "10:00"}</span>
              </div>
              <button type="button" className="rounded-full bg-white/10 p-2 backdrop-blur">
                <Volume2 className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <div>
          <h1 className="font-display text-xl font-semibold leading-tight text-foreground">
            {item.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="flex size-10 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: `hsla(${item.hue}, 50%, 40%, 0.35)` }}
              >
                {item.creator.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">@{item.creator}</p>
                <p className="text-xs text-muted-foreground">128K subscribers</p>
              </div>
              <button
                type="button"
                className="ml-2 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background"
              >
                Subscribe
              </button>
            </div>
            <div className="flex items-center gap-2">
              {["Like", "Share", "Save"].map((action) => (
                <button
                  key={action}
                  type="button"
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">
              {item.views} views · {item.age}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">
              Desktop watch layout mock. Player chrome, creator row, and related rail — no playback
              backend yet.
            </p>
          </div>
        </div>
      </div>

      <aside className="min-h-0 space-y-2 overflow-y-auto xl:pr-1">
        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Up next
        </p>
        {RELATED.map((related) => (
          <CompactRow key={related.id} item={related} />
        ))}
      </aside>
    </div>
  );
}
