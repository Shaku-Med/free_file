import { useMemo, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { buildEpisodeTree, type EpisodeRow } from "~/lib/series/episodeTree";
import { Dialog, DialogContent, DialogTrigger } from "~/components/ui/dialog";

type EpisodePickerProps = {
  /** Flat list of episodes (with optional `parent_episode_id`). */
  episodes: readonly EpisodeRow[];
  /** Currently selected episode id, or `null` for the placeholder/none state. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** Trigger label when nothing's picked. */
  placeholder?: string;
  /** Adds a top "(none)" option that maps to `null` (used for "Top-level episode" pickers). */
  noneLabel?: string | null;
  disabled?: boolean;
  className?: string;
  /** Aria label for the trigger. */
  triggerAriaLabel?: string;
};

const INDENT_PX = 16;

/**
 * Themed replacement for the native `<select>` we used for series-episode pickers.
 * Built on the existing shadcn Popover + div so it matches the rest of the app
 * (border, radius, hover, focus ring) and supports nested hierarchies via depth-based
 * indentation. Selecting a non-top-level episode shows the breadcrumb path under the
 * trigger so users always see exactly where in the tree they're saving to.
 */
export function EpisodePicker({
  episodes,
  value,
  onChange,
  placeholder = "Select episode…",
  noneLabel = null,
  disabled = false,
  className,
  triggerAriaLabel,
}: EpisodePickerProps) {
  const tree = useMemo(() => buildEpisodeTree(episodes), [episodes]);
  const selected = useMemo(() => tree.find((n) => n.id === value) ?? null, [tree, value]);
  const [open, setOpen] = useState(false);

  const triggerLabel = selected
    ? selected.name
    : value == null && noneLabel != null
      ? noneLabel
      : placeholder;

  return (
    <div className={cn("space-y-1", className)}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={triggerAriaLabel ?? "Choose episode"}
            disabled={disabled || tree.length === 0}
            className={cn(
              "h-9 w-full justify-between gap-2 rounded-xl border-border/60 bg-background px-3 text-left text-sm font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent
          className="w-full max-h-full max-w-2xl p-0 overflow-y-auto"
        >
          <div className="h-full max-h-full ">
            <div className="p-1">
              {noneLabel != null && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    value == null && "bg-accent/60",
                  )}
                >
                  <Check
                    className={cn("h-4 w-4 shrink-0", value == null ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="truncate text-muted-foreground">{noneLabel}</span>
                </button>
              )}
              {tree.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">No episodes yet.</div>
              ) : (
                tree.map((ep) => {
                  const isActive = ep.id === value;
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => {
                        onChange(ep.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        isActive && "bg-accent/60",
                      )}
                      style={{ paddingLeft: 8 + ep.depth * INDENT_PX }}
                      title={ep.pathLabel}
                    >
                      <Check
                        className={cn("h-4 w-4 shrink-0", isActive ? "opacity-100" : "opacity-0")}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{ep.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {selected && selected.depth > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Path: <span className="text-foreground">{selected.pathLabel}</span>
        </p>
      )}
    </div>
  );
}
