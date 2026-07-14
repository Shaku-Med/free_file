import { useState } from "react";
import { CONTINUE_WATCHING, FEED_ITEMS, HOME_CHIPS } from "@/data/mock";
import { MediaCard } from "@/components/MediaCard";

export function HomePage() {
  const [chip, setChip] = useState<(typeof HOME_CHIPS)[number]>("All");

  return (
    <div className="space-y-7 px-5 py-5">
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-foreground">Continue watching</h2>
            <p className="text-xs text-muted-foreground">Pick up where you left off</p>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {CONTINUE_WATCHING.map((item) => (
            <div key={item.id} className="w-56 shrink-0">
              <MediaCard item={{ ...item, progress: item.progress ?? 0.35 }} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap gap-2">
          {HOME_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChip(c)}
              className={[
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
                chip === c
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="feed-grid">
          {FEED_ITEMS.map((item) => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}
