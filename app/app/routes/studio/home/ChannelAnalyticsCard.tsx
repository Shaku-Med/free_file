import { Link } from "react-router";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";
import { CardSection, DashCard, MetricRow, Skeleton, studioButton } from "../components/StudioUI";
import { PostThumb, postAnalyticsHref, postTitle } from "./PostThumb";
import type { DashboardResponse } from "./dashboardTypes";

const TITLE = "Channel analytics";

function Change({ current, previous }: { current: number; previous: number | null }) {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        up ? "text-primary" : "text-muted-foreground",
      )}
      title="Compared to the 28 days before"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(pct)}%
    </span>
  );
}

export function ChannelAnalyticsCard({
  data,
  loading,
  username,
}: {
  data: DashboardResponse | null;
  loading: boolean;
  username?: string | null;
}) {
  const footer = (
    <>
      <Link to="/brozystudio/analytics" className={studioButton}>
        Go to channel analytics
      </Link>
      {username && (
        <Link to={`/profile/${encodeURIComponent(username)}`} className={studioButton}>
          View channel
        </Link>
      )}
    </>
  );

  if (loading && !data) {
    return (
      <DashCard title={TITLE} footer={footer}>
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="mt-2 h-9 w-24" />
        <Skeleton className="mt-2 h-3 w-36" />
        <div className="mt-6 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-3.5 w-full" />
          ))}
        </div>
      </DashCard>
    );
  }

  if (!data) {
    return (
      <DashCard title={TITLE} footer={footer}>
        <p className="text-sm text-muted-foreground">Your numbers could not load. Try refreshing.</p>
      </DashCard>
    );
  }

  const { channel, topRecent, analytics } = data;

  return (
    <DashCard title={TITLE} footer={footer}>
      <CardSection>
        <p className="text-sm text-muted-foreground">Current subscribers</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-foreground">
          {channel.subscribers.toLocaleString()}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {channel.newSubscribers28d > 0 ? (
            <>
              <span className="font-medium text-primary">
                +{channel.newSubscribers28d.toLocaleString()}
              </span>{" "}
              in the last 28 days
            </>
          ) : (
            "No new subscribers in the last 28 days"
          )}
        </p>
      </CardSection>

      <CardSection label="Summary" meta="Last 28 days">
        <MetricRow
          label="Views"
          value={formatNumber(channel.views28d)}
          trail={<Change current={channel.views28d} previous={channel.viewsPrev28d} />}
        />
        <MetricRow label="Watch time (hours, est.)" value={channel.watchHours28d.toFixed(1)} />
        <MetricRow label="Posts published" value={formatNumber(channel.posts28d)} />
        {!analytics && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Views here are the totals of posts published in the last 28 days.
          </p>
        )}
      </CardSection>

      <CardSection label="Top content" meta="Last 48 hours · Views">
        {topRecent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {analytics ? "No views in the last 48 hours yet." : "Not enough data yet."}
          </p>
        ) : (
          <ol className="-mx-2 space-y-0.5">
            {topRecent.map((post) => (
              <li key={post.unique_id}>
                <Link
                  to={postAnalyticsHref(post)}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50"
                >
                  <PostThumb post={post} className="h-9 w-16 shrink-0 rounded-md" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {postTitle(post)}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatNumber(post.views)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardSection>
    </DashCard>
  );
}
