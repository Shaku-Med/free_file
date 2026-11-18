import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "~/lib/utils";
import EmptyState from "~/components/EmptyState";

export { EmptyState };

/**
 * The studio's shared surfaces. Every page builds from these so the spacing,
 * radius and borders stay in step instead of each page repeating its own
 * rounded-lg border-border/60 bg-card/40 by hand.
 */

/** Panels and tiles share one radius; controls inside them go one step down. */
const SURFACE = "rounded-xl border border-border/60 bg-card/40";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A page's outermost wrapper, so every studio page breathes the same way. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-6", className)}>{children}</div>;
}

export function Panel({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Pass "p-0" for tables and lists that own their own edges. */
  bodyClassName?: string;
}) {
  return (
    <section className={cn(SURFACE, "overflow-hidden", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-5">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            {icon}
            <span className="truncate">{title}</span>
          </h2>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Delta({ value, unit }: { value: number; unit?: string }) {
  if (!value) return null;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        up ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? "+" : "−"}
      {Math.abs(value).toLocaleString()}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

export function StatTile({
  label,
  value,
  delta,
  hint,
  loading,
}: {
  label: string;
  value: ReactNode;
  delta?: number;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className={cn(SURFACE, "px-4 py-3.5")}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      {!loading && (delta !== undefined || hint) && (
        <div className="mt-1 min-h-[1.25rem] text-xs text-muted-foreground">
          {delta !== undefined ? <Delta value={delta} /> : hint}
        </div>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("inline-block animate-pulse rounded bg-muted", className)} />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {children}
    </div>
  );
}

/** Shared button look, so the studio's own controls do not each invent one. */
export const studioButton =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";

/**
 * The dashboard's card: title on the card itself rather than in a bar, with
 * sections split by hairlines and the actions along the bottom.
 */
export function DashCard({
  title,
  subtitle,
  action,
  footer,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(SURFACE, "flex min-w-0 flex-col", className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action && <div className="-mr-1.5 -mt-1 shrink-0">{action}</div>}
      </div>
      <div className="flex-1 px-5 pb-5 pt-4">{children}</div>
      {footer && (
        <div className="flex flex-wrap gap-2 border-t border-border/50 px-5 py-3.5">{footer}</div>
      )}
    </section>
  );
}

export function CardSection({
  label,
  meta,
  children,
}: {
  label?: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border/50 pt-4 first:border-t-0 first:pt-0 [&+&]:mt-4">
      {(label || meta) && (
        <div className="mb-2.5">
          {label && <h3 className="text-sm font-medium text-foreground">{label}</h3>}
          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

/** A label and value on one line, the dashboard's basic stat row. */
export function MetricRow({
  label,
  value,
  trail,
}: {
  label: ReactNode;
  value: ReactNode;
  trail?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-2 font-medium tabular-nums text-foreground">
        {value}
        {trail}
      </span>
    </div>
  );
}

const pagerButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35";

export function Pager({
  index,
  count,
  onChange,
  label,
}: {
  index: number;
  count: number;
  onChange: (next: number) => void;
  label: string;
}) {
  if (count < 2) return null;
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={label}>
      <span className="mr-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
        {index + 1} / {count}
      </span>
      <button
        type="button"
        className={pagerButton}
        onClick={() => onChange(index - 1)}
        disabled={index === 0}
        aria-label="Previous"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        className={pagerButton}
        onClick={() => onChange(index + 1)}
        disabled={index >= count - 1}
        aria-label="Next"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
