import { Link } from "react-router";
import { Minus, TrendingDown, TrendingUp, Upload } from "lucide-react";
import { cn } from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { CardSection, DashCard, MetricRow, Skeleton, studioButton } from "../components/StudioUI";
import { PostThumb, postAnalyticsHref, postTitle } from "./PostThumb";
import type { LatestPost } from "./dashboardTypes";

const TITLE = "Latest post performance";

const daysLabel = (n: number) => (n === 1 ? "day" : `${n} days`);

function VsTypical({ views, typical }: { views: number; typical: number }) {
  const ratio = typical > 0 ? views / typical : views > 0 ? 2 : 1;
  const state = ratio >= 1.15 ? "above" : ratio <= 0.85 ? "below" : "about";
  const Icon = state === "above" ? TrendingUp : state === "below" ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        state === "above" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {state === "above" ? "Above typical" : state === "below" ? "Below typical" : "About typical"}
    </span>
  );
}

function Totals({ post }: { post: LatestPost }) {
  const items = [
    { label: "Views", value: post.view_count },
    { label: "Likes", value: post.like_count },
    { label: "Comments", value: post.comment_count },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg bg-muted/40 px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">{it.label}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
            {formatNumber(it.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function LatestPostCard({
  post,
  loading,
  onUpload,
}: {
  post: LatestPost | null;
  loading: boolean;
  onUpload: () => void;
}) {
  if (loading && !post) {
    return (
      <DashCard title={TITLE}>
        <Skeleton className="aspect-video w-full rounded-lg" />
        <Skeleton className="mt-3 h-4 w-4/5" />
        <Skeleton className="mt-2 h-3 w-1/3" />
        <div className="mt-5 space-y-2.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-full" />
        </div>
      </DashCard>
    );
  }

  if (!post) {
    return (
      <DashCard title={TITLE}>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your newest post shows up here with how it is doing next to your usual numbers.
        </p>
        <button type="button" onClick={onUpload} className={cn(studioButton, "mt-4")}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Upload your first post
        </button>
      </DashCard>
    );
  }

  const href = postAnalyticsHref(post);
  const win = post.window;
  const hasComparison = post.rank !== null || win !== null;

  return (
    <DashCard
      title={TITLE}
      footer={
        <>
          <Link to={href} className={studioButton}>
            Go to post analytics
          </Link>
          <Link to="/brozystudio/comments" className={studioButton}>
            See comments
          </Link>
        </>
      }
    >
      <Link to={href} className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <PostThumb post={post} showDuration className="aspect-video w-full rounded-lg" />
        <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug text-foreground group-hover:underline">
          {postTitle(post)}
        </p>
      </Link>
      <p className="mt-0.5 text-xs text-muted-foreground">Published {formatTimeAgo(post.created_at)}</p>

      <div className="mt-5">
        {hasComparison && (
          <CardSection
            label={win ? `First ${daysLabel(win.days)}` : "So far"}
            meta={win ? "Compared to how your recent posts did in the same time" : undefined}
          >
            {post.rank !== null && (
              <MetricRow label="Ranking by views" value={`${post.rank} of ${post.rankOf}`} />
            )}
            {win && (
              <MetricRow
                label="Views"
                value={formatNumber(win.views)}
                trail={
                  win.typical !== null && (win.views > 0 || win.typical > 0) ? (
                    <VsTypical views={win.views} typical={win.typical} />
                  ) : null
                }
              />
            )}
            {win && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {win.typical === null
                  ? "Post a few more and this will show how each one compares."
                  : win.typical === 0 && win.views === 0
                    ? `No views in the first ${daysLabel(win.days)} yet, same as your recent posts.`
                    : `Your recent posts usually get ${formatNumber(win.typical)} in their first ${daysLabel(win.days)}.`}
              </p>
            )}
          </CardSection>
        )}
        <CardSection label="All time">
          <Totals post={post} />
        </CardSection>
      </div>
    </DashCard>
  );
}
