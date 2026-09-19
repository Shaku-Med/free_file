import { Check, ChevronDown } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/**
 * A themed select.
 *
 * Built on DropdownMenu rather than @radix-ui/react-select so it needs no new
 * dependency. A native <select> renders its list with the operating system's
 * own styling, which ignores the theme and shows up as a grey block in dark
 * mode; this keeps the popover on our tokens.
 */

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

export function Select<T extends string | number>({
  value,
  options,
  onValueChange,
  label,
  className,
  contentClassName,
  align = "start",
}: {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onValueChange: (value: T) => void;
  /** Names the control for assistive tech, since there is no visible <label>. */
  label: string;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
}) {
  const active = options.find((o) => o.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            className,
          )}
        >
          <span className="truncate">{active?.label ?? ""}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn("min-w-[10rem]", contentClassName)}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <DropdownMenuItem
              key={String(option.value)}
              onSelect={() => onValueChange(option.value)}
              className={cn("gap-2", selected && "bg-accent text-accent-foreground")}
            >
              <Check
                className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")}
                aria-hidden
              />
              <span className="truncate">{option.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
