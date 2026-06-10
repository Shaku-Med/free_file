import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Shared empty-state block: icon chip, title, optional description, optional
 * action. Keeps "nothing here yet" screens consistent across the app.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-4 py-14 text-center", className)}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-base font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
