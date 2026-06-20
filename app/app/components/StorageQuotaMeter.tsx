import { useCallback, useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { signedFetch } from "~/lib/Security/requestSigning.client";
import { cn } from "~/lib/utils";
import { formatBytes, formatMB } from "~/lib/formatBytes";

interface OverflowData {
  used: number;
  limit: number;
  remaining: number;
  windowDays: number;
}

interface QuotaData {
  used: number;
  limit: number;
  remaining: number;
  windowDays: number;
  /** Extra (overflow) allowance that opens once the monthly limit is full. */
  overflow?: OverflowData;
}

interface StorageQuotaMeterProps {
  /** Provide to render without fetching; otherwise the meter fetches /api/upload/quota. */
  data?: QuotaData;
  /** "card" for settings, "compact" for the upload modal. */
  variant?: "card" | "compact";
  /** Change this value to trigger a refetch (e.g. after an upload completes). */
  refreshKey?: unknown;
  className?: string;
}


function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-primary";
}

/**
 * Reusable monthly upload-budget meter. Drop it anywhere; by default it
 * fetches the signed-in user's usage. Includes a "?" that explains the limit.
 *
 * The window is a rolling 30-day cap (see app/database/migrations/monthly_upload_quota.sql)
 * not a calendar month, so usage frees up as old uploads age out one day at
 * a time rather than resetting on the 1st.
 */
export function StorageQuotaMeter({
  data,
  variant = "card",
  refreshKey,
  className,
}: StorageQuotaMeterProps) {
  const [quota, setQuota] = useState<QuotaData | null>(data ?? null);
  const [loading, setLoading] = useState(!data);
  const [failed, setFailed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const load = useCallback(async () => {
    if (data) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await signedFetch("/api/upload/quota", { method: "GET" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = (await res.json()) as Partial<QuotaData>;
      if (
        typeof body.used === "number" &&
        typeof body.limit === "number" &&
        typeof body.remaining === "number"
      ) {
        const ov = body.overflow;
        const overflow: OverflowData | undefined =
          ov &&
          typeof ov.used === "number" &&
          typeof ov.limit === "number" &&
          typeof ov.remaining === "number"
            ? {
                used: ov.used,
                limit: ov.limit,
                remaining: ov.remaining,
                windowDays: typeof ov.windowDays === "number" ? ov.windowDays : 7,
              }
            : undefined;
        setQuota({
          used: body.used,
          limit: body.limit,
          remaining: body.remaining,
          windowDays: typeof body.windowDays === "number" ? body.windowDays : 30,
          overflow,
        });
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    if (data) {
      setQuota(data);
      setLoading(false);
      return;
    }
    void load();
  }, [data, load, refreshKey]);

  // Stay silent on failure (e.g. signed out) so we never block the host UI.
  if (failed && !quota) return null;

  // Reusable bar for any used/limit pair (monthly budget + extra allowance).
  const barFor = (u: number, l: number) => {
    const p = l > 0 ? Math.min(100, (u / l) * 100) : 0;
    return (
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <div
            className="h-2 w-full cursor-help overflow-hidden rounded-full bg-muted"
            aria-label={`${formatBytes(u)} used of ${formatBytes(l)}`}
          >
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", barColor(p))}
              style={{ width: `${p}%` }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="space-y-0.5 font-mono tabular-nums">
            <div>Used: {formatMB(u)}</div>
            <div>Limit: {formatMB(l)}</div>
            <div>Left: {formatMB(Math.max(l - u, 0))}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const HelpButton = (
    <button
      type="button"
      onClick={() => setHelpOpen(true)}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label="Why is there an upload limit?"
    >
      <HelpCircle className="h-4 w-4" />
    </button>
  );

  const limitLabel = quota ? formatBytes(quota.limit) : "";
  const usedLabel = quota ? formatBytes(quota.used) : "";
  const remainingLabel = quota ? formatBytes(quota.remaining) : "";

  // Extra (overflow) allowance is folded into the SAME bar instead of a second
  // block, so the whole meter stays one compact line.
  const ov = quota?.overflow;
  const hasOverflow = Boolean(ov && ov.limit > 0);
  const totalLimit = quota ? quota.limit + (hasOverflow ? ov!.limit : 0) : 0;
  const totalUsed = quota ? quota.used + (hasOverflow ? ov!.used : 0) : 0;

  // Right-aligned header value + the single caption under the bar.
  const headerValue = !quota
    ? "…"
    : hasOverflow
      ? `${formatBytes(totalUsed)} / ${formatBytes(totalLimit)}`
      : `${usedLabel} / ${limitLabel}`;
  const caption = !quota
    ? ""
    : hasOverflow
      ? `${remainingLabel} left this month + ${formatBytes(ov!.remaining)} extra`
      : `${remainingLabel} left this month`;

  // One bar. With overflow it becomes a two-zone gauge — monthly | extra —
  // split by a hairline; the extra zone uses a lighter track so it reads as a
  // bonus bucket. The tooltip carries the precise per-bucket breakdown.
  const StorageBar = !quota ? (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" />
  ) : !hasOverflow ? (
    barFor(quota.used, quota.limit)
  ) : (
    (() => {
      const total = quota.limit + ov!.limit;
      const monthlyZone = (quota.limit / total) * 100;
      const extraZone = (ov!.limit / total) * 100;
      const monthlyFill = quota.limit > 0 ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
      const extraFill = ov!.limit > 0 ? Math.min(100, (ov!.used / ov!.limit) * 100) : 0;
      return (
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <div
              className="flex h-2 w-full cursor-help items-stretch overflow-hidden rounded-full"
              aria-label={`${formatBytes(totalUsed)} used of ${formatBytes(total)} including extra storage`}
            >
              <div className="relative h-full bg-muted" style={{ width: `${monthlyZone}%` }}>
                <div
                  className={cn("h-full transition-[width] duration-500", barColor(monthlyFill))}
                  style={{ width: `${monthlyFill}%` }}
                />
              </div>
              <div className="h-full w-px shrink-0 bg-background/80" aria-hidden />
              <div className="relative h-full bg-muted/50" style={{ width: `${extraZone}%` }}>
                <div
                  className="h-full bg-primary/60 transition-[width] duration-500"
                  style={{ width: `${extraFill}%` }}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="space-y-1 font-mono tabular-nums">
              <div>Monthly: {formatMB(quota.used)} / {formatMB(quota.limit)}</div>
              <div>
                Extra: {formatMB(ov!.used)} / {formatMB(ov!.limit)} · {formatBytes(ov!.remaining)} left this week
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      );
    })()
  );

  const Explainer = (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Monthly upload limit</DialogTitle>
          <DialogDescription className="sr-only">Upload budget details</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Free app, free storage costs money. You get{" "}
            <span className="font-medium text-foreground">{limitLabel || "a set amount"}</span>{" "}
            to upload every 30 days.
          </p>
          <p>
            Filled up the monthly budget? You still get an{" "}
            <span className="font-medium text-foreground">extra 10 GB per week</span> on top, so
            you're never fully blocked.
          </p>
          <p>
            Rolling window. Space frees up as your old uploads age past 30 days. Nothing already
            posted gets removed.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (variant === "compact") {
    return (
      <div className={cn("w-full", className)}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground">Upload storage</span>
            {HelpButton}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {loading || !quota ? "…" : headerValue}
          </span>
        </div>
        {StorageBar}
        {quota && caption && (
          <p className="mt-1.5 text-xs text-muted-foreground">{caption}</p>
        )}
        {Explainer}
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          Storage
          {HelpButton}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {loading || !quota ? "…" : headerValue}
        </span>
      </div>
      {StorageBar}
      {quota && caption && (
        <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
      )}
      {Explainer}
    </div>
  );
}

export default StorageQuotaMeter;
