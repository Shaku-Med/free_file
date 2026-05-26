import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { formatNumber } from "~/lib/utils/formatNumber";
import { getThumbnailUrl, cn } from "~/lib/utils";
import {
  Bookmark,
  Heart,
  Loader2,
  MessageSquare,
  Play,
  Share2,
} from "lucide-react";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Post Analytics | Memories",
    description: "Per post analytics for the owner.",
    canonicalPath: "/brozystudio/post",
  });

interface PostAnalytics {
  file: {
    id: string;
    unique_id: string;
    filename: string;
    file_title: string | null;
    file_description: string | null;
    file_type: string;
    endpoint: string;
    duration: number;
    created_at: string;
    is_public: boolean;
    is_adult: boolean;
    is_reel: boolean;
    default_thumbnail: string | null;
    thumbnails: string[] | null;
  };
  kpis: {
    views: number;
    likes: number;
    comments: number;
    totalPlayTimeSec: number;
    avgWatchSec: number;
    watchedFullPct: number;
  };
  window: { days: number; startDate: string };
  timeline: { date: string; views: number }[];
}

type Tab = "overview" | "viewers" | "engagement";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "viewers", label: "Viewers" },
  { key: "engagement", label: "Engagement" },
];

function formatPlayTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}h:${String(m).padStart(2, "0")}m:${String(r).padStart(2, "0")}s`;
}

function PostLineChart({ points }: { points: { date: string; views: number }[] }) {
  if (points.length === 0) return <div className="h-56 w-full animate-pulse rounded bg-muted" />;
  const width = 1000;
  const height = 240;
  const padL = 16;
  const padR = 56;
  const padT = 16;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.views));
  const niceMax = Math.ceil(max * 1.15);
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
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = (niceMax * (ticks - i)) / ticks;
    const y = padT + (innerH * i) / ticks;
    return { v, y };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" preserveAspectRatio="none">
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
          <text x={width - padR + 6} y={t.y + 4} className="fill-muted-foreground text-[10px]">
            {formatNumber(Math.round(t.v))}
          </text>
        </g>
      ))}
      {area && <path d={area} className="fill-primary/10" />}
      {path && <path d={path} className="stroke-primary" strokeWidth={2} fill="none" />}
      {xy.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} className="fill-background stroke-primary" strokeWidth={2}>
          <title>{`${p.point.date}: ${p.point.views}`}</title>
        </circle>
      ))}
      {xy.map((p, i) => (
        <text
          key={`x-${i}`}
          x={p.x}
          y={height - 8}
          textAnchor={i === 0 ? "start" : i === xy.length - 1 ? "end" : "middle"}
          className="fill-muted-foreground text-[10px]"
        >
          {p.point.date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

export default function StudioPostAnalyticsPage() {
  const params = useParams();
  const uniqueId = (params.uniqueId ?? "").trim();
  const [data, setData] = useState<PostAnalytics | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!uniqueId) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/studio/post?unique_id=${encodeURIComponent(uniqueId)}&days=7`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (r.status === 403) {
          if (!cancelled) {
            setErr("You can only view analytics for your own posts.");
            setLoading(false);
          }
          return null;
        }
        if (r.status === 404) {
          if (!cancelled) {
            setErr("Post not found.");
            setLoading(false);
          }
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((json) => {
        if (cancelled || !json) return;
        if (!json.success) {
          setErr("Could not load analytics.");
          setLoading(false);
          return;
        }
        setData(json as PostAnalytics);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setErr("Could not load analytics.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uniqueId]);

  const thumb = useMemo(() => {
    if (!data?.file) return null;
    try {
      return getThumbnailUrl({
        default_thumbnail: data.file.default_thumbnail,
        thumbnails: data.file.thumbnails,
        file_type: data.file.file_type,
        endpoint: data.file.endpoint,
        created_at: data.file.created_at,
        unique_id: data.file.unique_id,
        filename: data.file.filename,
      });
    } catch {
      return null;
    }
  }, [data]);

  if (err) {
    return (
      <section className="space-y-4">
        <Link to="/brozystudio/posts" className="text-xs text-muted-foreground hover:text-foreground">
          ← Back to posts
        </Link>
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link to="/brozystudio/posts" className="hover:text-foreground">
          ← Back to posts
        </Link>
        <span className="ml-auto">
          Updated {new Date().toLocaleDateString()}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-border/60 pb-1">
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

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !data ? null : (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
            <Link to={`/${data.file.unique_id}`} className="relative h-14 w-20 shrink-0 overflow-hidden rounded bg-muted">
              {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                to={`/${data.file.unique_id}`}
                className="block truncate text-sm font-semibold text-foreground hover:text-primary"
              >
                {data.file.file_title?.trim() || data.file.filename || "Untitled"}
              </Link>
              <p className="text-xs text-muted-foreground">
                Posted on {new Date(data.file.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="hidden gap-4 text-xs text-muted-foreground sm:flex">
              <span className="inline-flex flex-col items-center">
                <Play className="h-4 w-4" />
                <span className="mt-0.5 tabular-nums text-foreground">{formatNumber(data.kpis.views)}</span>
              </span>
              <span className="inline-flex flex-col items-center">
                <Heart className="h-4 w-4" />
                <span className="mt-0.5 tabular-nums text-foreground">{formatNumber(data.kpis.likes)}</span>
              </span>
              <span className="inline-flex flex-col items-center">
                <MessageSquare className="h-4 w-4" />
                <span className="mt-0.5 tabular-nums text-foreground">{formatNumber(data.kpis.comments)}</span>
              </span>
              <span className="inline-flex flex-col items-center">
                <Share2 className="h-4 w-4" />
                <span className="mt-0.5 tabular-nums text-foreground">0</span>
              </span>
              <span className="inline-flex flex-col items-center">
                <Bookmark className="h-4 w-4" />
                <span className="mt-0.5 tabular-nums text-foreground">0</span>
              </span>
            </div>
          </div>

          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {[
                  { label: "Video views", value: formatNumber(data.kpis.views), highlight: true },
                  { label: "Total play time", value: formatPlayTime(data.kpis.totalPlayTimeSec) },
                  { label: "Average watch time", value: `${data.kpis.avgWatchSec.toFixed(2)}s` },
                  { label: "Watched full video", value: `${data.kpis.watchedFullPct}%` },
                  { label: "New followers", value: "0" },
                ].map((t) => (
                  <div
                    key={t.label}
                    className={cn(
                      "rounded-lg border bg-card/40 px-4 py-3",
                      t.highlight ? "border-primary/40" : "border-border/60",
                    )}
                  >
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</div>
                    <div
                      className={cn(
                        "mt-1 text-2xl font-semibold tabular-nums",
                        t.highlight ? "text-primary" : "text-foreground",
                      )}
                    >
                      {t.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border/60 bg-card/40 p-4">
                <PostLineChart points={data.timeline} />
              </div>
            </>
          )}

          {tab === "viewers" && (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-12 text-center text-sm text-muted-foreground">
              Viewer demographics for this post come once we aggregate watch sessions.
            </div>
          )}

          {tab === "engagement" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: "Likes", value: formatNumber(data.kpis.likes) },
                { label: "Comments", value: formatNumber(data.kpis.comments) },
                { label: "Watch hours", value: ((data.kpis.totalPlayTimeSec || 0) / 3600).toFixed(2) },
              ].map((t) => (
                <div key={t.label} className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{t.value}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
