import { FEED_ITEMS } from "@/data/mock";
import { MediaCard } from "@/components/MediaCard";

export function SubscriptionsPage() {
  return (
    <div className="space-y-5 px-5 py-5">
      <div>
        <h2 className="font-display text-base font-semibold text-foreground">From creators you follow</h2>
        <p className="text-xs text-muted-foreground">UI mock — subscriptions feed layout</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {["mira.lens", "knox.audio", "yuki.frames", "nova.bites", "forge.home", "north.series"].map(
          (name, i) => (
            <button
              key={name}
              type="button"
              className="flex w-20 shrink-0 flex-col items-center gap-2"
            >
              <div
                className="flex size-14 items-center justify-center rounded-full border-2 border-primary/50 text-xs font-bold text-foreground"
                style={{
                  background: `hsla(${i * 48}, 55%, 40%, 0.35)`,
                }}
              >
                {name.slice(0, 2).toUpperCase()}
              </div>
              <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                @{name}
              </span>
            </button>
          ),
        )}
      </div>
      <div className="feed-grid">
        {FEED_ITEMS.filter((_, i) => i % 2 === 0).map((item) => (
          <MediaCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
