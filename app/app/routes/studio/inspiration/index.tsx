import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { formatNumber } from "~/lib/utils/formatNumber";
import { TrendingUp, Tag } from "lucide-react";
import { useStudioData } from "~/lib/studio/studioCache";
import {
  ErrorNote,
  PageBody,
  PageHeader,
  Panel,
  Skeleton,
} from "../components/StudioUI";

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

  const tagSection = (rows: TagRow[], keyPrefix: string, empty: string) => {
    if (loading) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-full" />
          ))}
        </div>
      );
    }
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {rows.map((t) => (
          <TagPill key={`${keyPrefix}-${t.tag}`} row={t} />
        ))}
      </div>
    );
  };

  return (
    <PageBody>
      <PageHeader title="Inspiration" />

      {err && <ErrorNote>Could not load inspiration. Try refreshing.</ErrorNote>}

      <Panel
        title="Trending this week"
        icon={<TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />}
      >
        {tagSection(data?.trending ?? [], "trend", "Not enough activity yet this week.")}
      </Panel>

      <Panel
        title="Your top tags"
        icon={<Tag className="h-4 w-4 text-muted-foreground" aria-hidden />}
      >
        {tagSection(
          data?.yours ?? [],
          "mine",
          "Tag your uploads to start seeing patterns here.",
        )}
      </Panel>
    </PageBody>
  );
}
