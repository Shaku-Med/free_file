import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Shared empty-state block: icon chip, title, optional description, optional
 * action. Keeps "nothing here yet" screens consistent across the app.
 *
 * `plain` is the original bare block. `panel` adds the dashed surface for use
 * inside a card or list, and `page` is the larger version for a route that has
 * nothing at all to show.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "plain",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "plain" | "panel" | "page";
  className?: string;
}) {
  const page = variant === "page";
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 text-center",
        page ? "py-20" : "py-14",
        variant === "panel" &&
          "gap-3 rounded-xl border border-dashed border-border/60 bg-muted/10 px-6 py-12",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-muted",
          variant === "panel" ? "h-11 w-11" : "h-16 w-16",
        )}
      >
        <Icon
          className={cn("text-muted-foreground", variant === "panel" ? "h-5 w-5" : "h-8 w-8")}
          aria-hidden
        />
      </div>
      <p
        className={cn(
          "font-medium text-foreground",
          page ? "text-xl font-semibold sm:text-2xl" : "text-base",
        )}
      >
        {title}
      </p>
      {description ? (
        <p className={cn("text-sm text-muted-foreground", page ? "max-w-md" : "max-w-xs")}>
          {description}
        </p>
      ) : null}
      {action ? <div className={variant === "panel" ? "mt-1" : "mt-2"}>{action}</div> : null}
    </div>
  );
}
