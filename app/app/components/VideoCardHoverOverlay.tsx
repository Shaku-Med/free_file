import { useMemo } from "react";
import { fileHoverTint } from "~/components/components/hlsplayer/visualizerPalette";
import { cn } from "~/lib/utils";

type VideoCardHoverOverlayProps = {
  /** `files.colors` (or any accent hex list). */
  colors?: unknown;
  /** Stable id so tint pick is stable per card. */
  seed: string;
  className?: string;
  /**
   * Surface mixed into the file color for the expanding backdrop.
   * Default matches the home grid card overlay.
   */
  surface?: string;
  /**
   * Paint behind the card's content instead of above it.
   *
   * The default mode raises itself over everything on hover, which is why those
   * layouts push their thumb and text to `z-[1000000]`. Layouts whose root is a
   * single Link with many loose children can't do that without z-indexing each
   * one, so they set `behind` and add `isolate` to the root: the overlay drops
   * to `-z-10` inside that stacking context and content paints above it with no
   * per-child changes.
   */
  behind?: boolean;
};

/**
 * Expanding tinted backdrop used on home VideoCards (`group-hover:scale-105`).
 * Parent must be `relative group`. Thumb + text must sit ABOVE the overlay
 * (e.g. `relative z-[1000000]`) — on hover this layer goes to `z-[100]`.
 */
export function VideoCardHoverOverlay({
  colors,
  seed,
  className,
  surface = "color-mix(in srgb, var(--muted) 85%, transparent)",
  behind = false,
}: VideoCardHoverOverlayProps) {
  const tint = useMemo(
    () => fileHoverTint(colors, seed, surface),
    [colors, seed, surface],
  );

  return (
    <div
      aria-hidden
      className={cn(
        "hover_overlay pointer-events-none absolute inset-0 rounded-2xl bg-muted/80 opacity-0 scale-100 transition-all duration-300 ease-out",
        // Written out rather than composed, so Tailwind can see both variants.
        behind
          ? "-z-10 group-hover:opacity-100 group-hover:scale-105"
          : "z-[10] group-hover:z-[100] group-hover:opacity-100 group-hover:scale-105",
        className,
      )}
      style={tint ? { background: tint } : undefined}
    />
  );
}
