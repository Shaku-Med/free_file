import { ChevronLeft, Heart, MessageCircle, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import { FEED_ITEMS } from "@/data/mock";

export function ReelsPage() {
  const reel = FEED_ITEMS.find((i) => i.kind === "reel") ?? FEED_ITEMS[1];

  return (
    <div className="relative flex h-full bg-black">
      <Link
        to="/"
        className="absolute left-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
      >
        <ChevronLeft className="size-3.5" />
        Back
      </Link>

      <div className="mx-auto flex h-full w-full max-w-[420px] flex-col">
        <div
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{
            background: `
              linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.75)),
              linear-gradient(145deg, hsla(${reel.hue}, 70%, 45%, 0.55), #12151b)
            `,
          }}
        >
          <div className="absolute bottom-6 left-4 right-20 space-y-2 text-white">
            <p className="text-sm font-semibold">@{reel.creator}</p>
            <p className="text-sm leading-snug text-white/90">{reel.title}</p>
            <p className="text-xs text-white/55">
              {reel.views} views · {reel.age}
            </p>
          </div>

          <div className="absolute bottom-8 right-4 flex flex-col items-center gap-4 text-white">
            {[
              { icon: Heart, label: "12K" },
              { icon: MessageCircle, label: "318" },
              { icon: Share2, label: "Share" },
            ].map(({ icon: Icon, label }) => (
              <button key={label} type="button" className="flex flex-col items-center gap-1">
                <span className="flex size-11 items-center justify-center rounded-full bg-white/10 backdrop-blur">
                  <Icon className="size-5" />
                </span>
                <span className="text-[11px] font-medium text-white/80">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 border-t border-white/10 bg-black px-4 py-3">
          {FEED_ITEMS.filter((i) => i.kind === "reel")
            .slice(0, 4)
            .map((item, idx) => (
              <div
                key={item.id}
                className={[
                  "h-1.5 rounded-full transition",
                  idx === 0 ? "w-8 bg-primary" : "w-1.5 bg-white/25",
                ].join(" ")}
              />
            ))}
        </div>
      </div>

      <aside className="hidden w-72 shrink-0 flex-col border-l border-white/10 bg-[#0c0e12] p-4 lg:flex">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Up next in reels
        </p>
        <div className="space-y-3 overflow-y-auto">
          {FEED_ITEMS.filter((i) => i.kind === "reel").map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="line-clamp-2 text-sm font-medium text-white">{item.title}</p>
              <p className="mt-1 text-xs text-white/45">@{item.creator}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
