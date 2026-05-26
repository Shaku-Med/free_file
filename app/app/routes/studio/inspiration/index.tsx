import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { formatNumber } from "~/lib/utils/formatNumber";
import { TrendingUp, Tag, Loader2 } from "lucide-react";
import { useStudioData } from "~/lib/studio/studioCache";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Studio Inspiration | Memories",
    description: "Trending tags and topic ideas for your next post.",
    canonicalPath: "/brozystudio/inspiration",
  });

interface TagRow {
  tag: string;
  count: number;
  views: number;
}

interface InspirationResponse {
  trending: TagRow[];
  yours: TagRow[];
}

function TagPill({ row }: { row: TagRow }) {
  return (
    <Link
      to={`/tag/${encodeURIComponent(row.tag)}`}
      className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs transition-colors hover:bg-muted/30 hover:text-primary"
    >
      <Tag className="h-3 w-3" />
      <span className="font-medium text-foreground">{row.tag}</span>
      <span className="text-muted-foreground tabular-nums">
        {formatNumber(row.views)} views
      </span>
    </Link>
  );
}

interface InspirationApi {
  success: boolean;
  trending?: TagRow[];
  yours?: TagRow[];
}

export default function StudioInspirationPage() {
  const { data: raw, loading, error: err } = useStudioData<InspirationApi>({
    cacheKey: "studio:inspiration",
    url: "/api/studio/inspiration",
    ttlMs: 5 * 60_000,
  });
  const data: InspirationResponse | null = raw?.success
    ? { trending: raw.trending ?? [], yours: raw.yours ?? [] }
    : null;

  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Inspiration</h1>

      {err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load inspiration. Try refreshing.
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <TrendingUp className="h-4 w-4 text-primary" /> Trending this week
        </h2>
        {loading ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : data && data.trending.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.trending.map((t) => (
              <TagPill key={`trend-${t.tag}`} row={t} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Not enough activity yet this week.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Tag className="h-4 w-4 text-primary" /> Your top tags
        </h2>
        {loading ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : data && data.yours.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.yours.map((t) => (
              <TagPill key={`mine-${t.tag}`} row={t} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Tag your uploads to start seeing patterns here.
          </p>
        )}
      </div>
    </section>
  );
}
