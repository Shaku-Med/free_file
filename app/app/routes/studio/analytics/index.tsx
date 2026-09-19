import { lazy, Suspense, useMemo, useState } from "react";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { formatNumber } from "~/lib/utils/formatNumber";
import { cn } from "~/lib/utils";
import { BarChart3, Download, Users } from "lucide-react";
import { Select } from "~/components/ui/select";
import { useStudioData } from "~/lib/studio/studioCache";
import {
  EmptyState,
  ErrorNote,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
  studioButton,
} from "../components/StudioUI";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { useFileContext } from "~/lib/Context/Context";

// Lazy so recharts only downloads when the overview chart is actually shown.
const ViewsAreaChart = lazy(() => import("./ViewsAreaChart"));

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Studio Analytics | Memories",
    description: "Views, watch time, audience, and engagement.",
    canonicalPath: "/brozystudio/analytics",
  });

interface TopPost {
  id: string;
  unique_id: string;
  filename: string;
  file_title?: string | null;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  duration?: number | null;
  created_at: string;
  default_thumbnail?: string | null;
  thumbnails?: string[] | null;
  file_type: string;
  endpoint: string;
}

function TopPostStats({
  views,
  likes,
  comments,
  inline = false,
}: {
  views: number;
  likes: number;
  comments: number;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground sm:text-sm">
        <span>
          <span className="font-medium text-foreground">{formatNumber(views)}</span> views
        </span>
        <span>
          <span className="font-medium text-foreground">{formatNumber(likes)}</span> likes
        </span>
        <span>
          <span className="font-medium text-foreground">{formatNumber(comments)}</span> comments
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="text-sm tabular-nums text-foreground">{formatNumber(views)}</div>
      <div className="text-sm tabular-nums text-foreground">{formatNumber(likes)}</div>
      <div className="text-sm tabular-nums text-foreground">{formatNumber(comments)}</div>
    </>
  );
}

function TopPostRow({
  post,
  rank,
  userId,
}: {
  post: TopPost;
  rank: number;
  userId: string | null | undefined;
}) {
  const fileData = { ...post, owner_id: userId ?? undefined } as unknown as FileType;

  return (
    <li className="border-b border-border/50 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/15 sm:px-4 lg:grid lg:grid-cols-[36px_minmax(0,1fr)_repeat(3,minmax(56px,72px))] lg:items-center lg:gap-3 lg:px-4 lg:py-3">
      <div className="flex min-w-0 items-start gap-2.5 lg:contents">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            rank <= 3 ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground",
          )}
          aria-hidden
        >
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <VideoCard layout="studioRow" data={fileData} currentUserId={userId ?? undefined} />
        </div>
      </div>

      <div className="mt-2.5 pl-9 lg:mt-0 lg:contents lg:pl-0">
        <div className="lg:hidden">
          <TopPostStats
            inline
            views={post.view_count ?? 0}
            likes={post.like_count ?? 0}
            comments={post.comment_count ?? 0}
          />
        </div>
        <div className="hidden lg:contents">
          <TopPostStats
            views={post.view_count ?? 0}
            likes={post.like_count ?? 0}
            comments={post.comment_count ?? 0}
          />
        </div>
      </div>
    </li>
  );
}

interface AnalyticsResponse {
  window: { days: number };
  totals: {
    views: number;
    likes: number;
    comments: number;
    estWatchHours: number;
    subscribers: number;
  };
  timeline: { date: string; uploads: number; views: number }[];
  topPosts: TopPost[];
}

const RANGES = [
  { value: 7, label: "Last 7 days" },
  { value: 28, label: "Last 28 days" },
  { value: 90, label: "Last 90 days" },
] as const;

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r.value, label: r.label }));

type Tab = "overview" | "content" | "viewers" | "followers";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "content", label: "Content" },
  { key: "viewers", label: "Viewers" },
  { key: "followers", label: "Followers" },
];

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StudioAnalyticsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState<(typeof RANGES)[number]["value"]>(7);
  const { userId } = useFileContext();
  const { data, loading, error: err } = useStudioData<AnalyticsResponse>({
    cacheKey: `studio:analytics:${days}`,
    url: `/api/studio/analytics?days=${days}`,
    ttlMs: 60_000,
  });

  const previousWindowDelta = useMemo(() => {
    if (!data) return { views: 0, likes: 0, comments: 0 };
    const half = Math.floor(data.timeline.length / 2);
    let recent = 0;
    let prior = 0;
    data.timeline.forEach((b, i) => {
      if (i < half) prior += b.views;
      else recent += b.views;
    });
    return { views: recent - prior, likes: 0, comments: 0 };
  }, [data]);

  const onDownload = () => {
    if (!data) return;
    const rows: string[][] = [
      ["Date", "Views", "Uploads"],
      ...data.timeline.map((b) => [b.date, String(b.views), String(b.uploads)]),
    ];
    downloadCsv(`analytics-${days}d-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <PageBody>
      <PageHeader
        title="Analytics"
        actions={
          <>
            <Select
              value={days}
              options={RANGE_OPTIONS}
              onValueChange={setDays}
              label="Date range"
              align="end"
              className="text-xs"
            />
            <button type="button" onClick={onDownload} disabled={!data} className={studioButton}>
              <Download className="h-3.5 w-3.5" aria-hidden /> Download data
            </button>
          </>
        }
      />

      {/* Segmented control rather than a second row of underlined tabs: the rail
          already owns underline-style navigation and two levels of it read as
          one broken bar. */}
      <div className="flex w-full gap-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={cn(
              "flex-1 shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && <ErrorNote>Could not load analytics. Try refreshing.</ErrorNote>}

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Video views", value: data ? formatNumber(data.totals.views) : "—", delta: previousWindowDelta.views },
              { label: "Profile views", value: "—", delta: 0 },
              { label: "Likes", value: data ? formatNumber(data.totals.likes) : "—", delta: 0 },
              { label: "Comments", value: data ? formatNumber(data.totals.comments) : "—", delta: 0 },
              { label: "Watch hours", value: data ? data.totals.estWatchHours.toFixed(1) : "—", delta: 0 },
              { label: "Subscribers", value: data ? formatNumber(data.totals.subscribers) : "—", delta: 0 },
            ].map((t) => (
              <StatTile
                key={t.label}
                label={t.label}
                value={t.value}
                loading={loading}
                delta={t.delta || undefined}
              />
            ))}
          </div>

          <Panel
            title="Views"
            action={
              <span className="text-sm font-medium tabular-nums text-foreground">
                {formatNumber(data?.totals.views ?? 0)}
              </span>
            }
          >
            <p className="mb-3 text-xs text-muted-foreground">Last {days} days</p>
            {loading || !data ? (
              <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />
            ) : (
              <Suspense
                fallback={<div className="h-64 w-full animate-pulse rounded-lg bg-muted" />}
              >
                <ViewsAreaChart
                  data={data.timeline.map((b) => ({ date: b.date, views: b.views }))}
                />
              </Suspense>
            )}
          </Panel>
        </>
      )}

      {tab === "content" && (
        <Panel title="Top posts" bodyClassName="p-0">
          <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">
            Ranked by views in the selected date range.
          </p>

          {loading || !data ? (
            <div className="px-4 py-10 sm:px-5">
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : data.topPosts.length === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState
                variant="panel"
                icon={BarChart3}
                title="Nothing to rank yet"
              />
            </div>
          ) : (
            <div className="mt-3 border-t border-border/50">
              <div className="hidden border-b border-border/50 bg-muted/20 px-4 py-2.5 text-muted-foreground lg:grid lg:grid-cols-[36px_minmax(0,1fr)_repeat(3,minmax(56px,72px))] lg:items-center lg:gap-3 lg:px-5">
                <span className="text-xs font-medium uppercase tracking-wide">#</span>
                <span className="text-xs font-medium uppercase tracking-wide">Post</span>
                <span className="text-xs font-medium uppercase tracking-wide">Views</span>
                <span className="text-xs font-medium uppercase tracking-wide">Likes</span>
                <span className="text-xs font-medium uppercase tracking-wide">Comments</span>
              </div>
              <ul>
                {data.topPosts.map((p, i) => (
                  <TopPostRow key={p.id} post={p} rank={i + 1} userId={userId} />
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      {tab === "viewers" && (
        <EmptyState
          variant="panel"
          icon={Users}
          title="Viewer breakdown is not ready yet"
          description="This fills in once we aggregate watch session data."
        />
      )}

      {tab === "followers" && (
        <EmptyState
          variant="panel"
          icon={Users}
          title="Follower growth is coming"
          description={`You currently have ${
            data ? formatNumber(data.totals.subscribers) : "—"
          } subscribers.`}
        />
      )}
    </PageBody>
  );
}
