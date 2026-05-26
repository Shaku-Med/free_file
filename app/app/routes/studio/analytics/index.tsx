import { useMemo, useState } from "react";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { formatNumber } from "~/lib/utils/formatNumber";
import { cn } from "~/lib/utils";
import { ChevronDown, Download } from "lucide-react";
import { useStudioData } from "~/lib/studio/studioCache";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { useFileContext } from "~/lib/Context/Context";

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

type Tab = "overview" | "content" | "viewers" | "followers";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "content", label: "Content" },
  { key: "viewers", label: "Viewers" },
  { key: "followers", label: "Followers" },
];

function PolarisedDelta({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={cn("inline-flex items-center text-xs font-medium", up ? "text-primary" : "text-muted-foreground")}>
      {up ? "▲" : "▼"} {formatNumber(Math.abs(value))}
    </span>
  );
}

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

function LineChart({ points }: { points: { date: string; views: number }[] }) {
  if (points.length === 0) {
    return <div className="h-64 w-full rounded-md bg-muted/20" />;
  }
  const width = 1000;
  const height = 260;
  const padL = 16;
  const padR = 56;
  const padT = 16;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.views));
  const niceMax = Math.ceil(max * 1.1);
  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0;
  const xy = points.map((p, i) => {
    const x = padL + i * xStep;
    const y = padT + innerH - (p.views / niceMax) * innerH;
    return { x, y, point: p };
  });
  const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area =
    xy.length > 0
      ? `M${xy[0].x},${padT + innerH} ${xy
          .map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(" ")} L${xy[xy.length - 1].x},${padT + innerH} Z`
      : "";

  const ticks = 5;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = (niceMax * (ticks - i)) / ticks;
    const y = padT + (innerH * i) / ticks;
    return { v, y };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" preserveAspectRatio="none">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={width - padR}
            y1={t.y}
            y2={t.y}
            stroke="currentColor"
            className="text-border/40"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <text
            x={width - padR + 6}
            y={t.y + 4}
            className="fill-muted-foreground text-[10px]"
          >
            {formatNumber(Math.round(t.v))}
          </text>
        </g>
      ))}
      {area && <path d={area} className="fill-primary/10" />}
      {path && <path d={path} className="stroke-primary" strokeWidth={2} fill="none" />}
      {xy.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={3}
          className="fill-background stroke-primary"
          strokeWidth={2}
        >
          <title>{`${p.point.date}: ${p.point.views}`}</title>
        </circle>
      ))}
      {xy.length > 0 && (
        <>
          <text x={xy[0].x} y={height - 8} className="fill-muted-foreground text-[10px]">
            {xy[0].point.date.slice(5)}
          </text>
          <text
            x={xy[xy.length - 1].x}
            y={height - 8}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {xy[xy.length - 1].point.date.slice(5)}
          </text>
        </>
      )}
    </svg>
  );
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
    <section className="space-y-5">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 pb-1">
        <div className="flex flex-1 flex-wrap items-center gap-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "border-b-2 pb-2 text-sm font-semibold transition-colors",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-xs text-foreground">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as (typeof RANGES)[number]["value"])}
            className="bg-transparent outline-none"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </label>
        <button
          type="button"
          onClick={onDownload}
          disabled={!data}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/30 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Download data
        </button>
      </header>

      {err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load analytics. Try refreshing.
        </div>
      )}

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {[
              { label: "Video views", value: data ? formatNumber(data.totals.views) : "—", delta: previousWindowDelta.views },
              { label: "Profile views", value: "—", delta: 0 },
              { label: "Likes", value: data ? formatNumber(data.totals.likes) : "—", delta: 0 },
              { label: "Comments", value: data ? formatNumber(data.totals.comments) : "—", delta: 0 },
              { label: "Watch hours", value: data ? data.totals.estWatchHours.toFixed(1) : "—", delta: 0 },
              { label: "Subscribers", value: data ? formatNumber(data.totals.subscribers) : "—", delta: 0 },
            ].map((t) => (
              <div key={t.label} className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</div>
                <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
                  {loading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-muted" /> : t.value}
                </div>
                {!loading && t.delta !== 0 && (
                  <div className="mt-1">
                    <PolarisedDelta value={t.delta} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-4">
            {loading || !data ? (
              <div className="h-64 w-full animate-pulse rounded bg-muted" />
            ) : (
              <LineChart points={data.timeline.map((b) => ({ date: b.date, views: b.views }))} />
            )}
          </div>
        </>
      )}

      {tab === "content" && (
        <div className="overflow-hidden rounded-lg border border-border/60 bg-card/30">
          <div className="border-b border-border/60 px-3 py-3 sm:px-4">
            <h2 className="text-sm font-semibold text-foreground">Top posts</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Ranked by views in the selected date range.</p>
          </div>

          {loading || !data ? (
            <div className="px-4 py-10">
              <div className="h-24 animate-pulse rounded bg-muted" />
            </div>
          ) : data.topPosts.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No posts yet. Upload something to see analytics.
            </p>
          ) : (
            <>
              <div className="hidden border-b border-border/60 bg-muted/20 px-4 py-2.5 text-muted-foreground lg:grid lg:grid-cols-[36px_minmax(0,1fr)_repeat(3,minmax(56px,72px))] lg:items-center lg:gap-3">
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
            </>
          )}
        </div>
      )}

      {tab === "viewers" && (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-12 text-center text-sm text-muted-foreground">
          Viewer demographics wire in once we aggregate watch session data.
        </div>
      )}

      {tab === "followers" && (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-12 text-center text-sm text-muted-foreground">
          Follower growth charts come next. You currently have{" "}
          {data ? formatNumber(data.totals.subscribers) : "—"} subscribers.
        </div>
      )}
    </section>
  );
}
