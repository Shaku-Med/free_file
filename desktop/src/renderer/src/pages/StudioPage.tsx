import { BarChart3, Film, MessageSquare, Sparkles } from "lucide-react";
import { STUDIO_POSTS } from "@/data/mock";

const TABS = [
  { id: "posts", label: "Posts", icon: Film },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "comments", label: "Comments", icon: MessageSquare },
  { id: "inspiration", label: "Inspiration", icon: Sparkles },
] as const;

export function StudioPage() {
  return (
    <div className="space-y-5 px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">Brozy Studio</h2>
          <p className="text-sm text-muted-foreground">Creator workspace — UI shell only</p>
        </div>
        <button
          type="button"
          className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
        >
          Upload content
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Views (7d)", value: "184.2K" },
          { label: "Watch hours", value: "1,204" },
          { label: "Subscribers", value: "+312" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="mt-2 font-display text-2xl font-semibold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab, i) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={[
                "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold",
                i === 0
                  ? "bg-sidebar-active text-foreground ring-1 ring-primary/30"
                  : "border border-border text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[1.4fr_0.7fr_0.5fr_0.5fr_0.6fr] gap-3 border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Content</span>
          <span>Status</span>
          <span>Views</span>
          <span>Likes</span>
          <span>Comments</span>
        </div>
        {STUDIO_POSTS.map((post) => (
          <div
            key={post.id}
            className="grid grid-cols-[1.4fr_0.7fr_0.5fr_0.5fr_0.6fr] items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{post.title}</p>
              <p className="truncate text-xs text-muted-foreground">{post.duration ?? "Photo"}</p>
            </div>
            <span
              className={[
                "w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold",
                post.status === "Published"
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {post.status}
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">{post.views}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{post.likes}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{post.comments}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
