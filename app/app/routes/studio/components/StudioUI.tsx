import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
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
