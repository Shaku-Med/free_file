export type SlideDirection = "next" | "prev";

/** Carousel slide entrance. Skipped entirely when the viewer asks for less motion. */
export function slideIn(dir: SlideDirection): string {
  return dir === "next"
    ? "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-300"
    : "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-2 motion-safe:duration-300";
}
