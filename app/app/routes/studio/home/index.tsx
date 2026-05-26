import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { formatNumber } from "~/lib/utils/formatNumber";
import { useStudioData } from "~/lib/studio/studioCache";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Studio Home | Memories",
    description: "Brozy Studio home: at a glance creator workspace.",
    canonicalPath: "/brozystudio",
  });

interface Overview {
  totals: {
    posts: number;
    views: number;
    likes: number;
    comments: number;
    subscribers: number;
  };
  last28d: {
    views: number;
    watchHours: number;
  };
}

const TILES: { key: keyof Overview["totals"] | "watchHours" | "views28d"; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "subscribers", label: "Subscribers" },
  { key: "views28d", label: "Views (28d)" },
  { key: "watchHours", label: "Watch hours (28d)" },
];

interface OverviewResponse {
  success: boolean;
  totals: Overview["totals"];
  last28d: Overview["last28d"];
}

export default function StudioHomePage() {
  const { data: raw, loading, error: err } = useStudioData<OverviewResponse>({
    cacheKey: "studio:overview",
    url: "/api/studio/overview",
    ttlMs: 60_000,
  });
  const data: Overview | null = raw?.success
    ? { totals: raw.totals, last28d: raw.last28d }
    : null;

  const value = (k: (typeof TILES)[number]["key"]): string => {
    if (!data) return "—";
    if (k === "views28d") return formatNumber(data.last28d.views);
    if (k === "watchHours") return data.last28d.watchHours.toFixed(1);
    return formatNumber(data.totals[k]);
  };

  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Home</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TILES.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-border/60 bg-card/40 px-4 py-3"
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t.label}
            </div>
            <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
              {loading ? (
                <span className="inline-block h-6 w-12 animate-pulse rounded bg-muted" />
              ) : (
                value(t.key)
              )}
            </div>
          </div>
        ))}
      </div>

      {err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load your stats. Try refreshing.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          to="/brozystudio/posts"
          className="rounded-lg border border-border/60 bg-card/40 px-4 py-4 transition-colors hover:bg-muted/30"
        >
          <div className="text-sm font-semibold text-foreground">Posts</div>
        </Link>
        <Link
          to="/brozystudio/analytics"
          className="rounded-lg border border-border/60 bg-card/40 px-4 py-4 transition-colors hover:bg-muted/30"
        >
          <div className="text-sm font-semibold text-foreground">Analytics</div>
        </Link>
      </div>
    </section>
  );
}
