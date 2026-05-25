/**
 * WatchModalShell.tsx
 *
 * Wrapper around the watch / reel page content. Currently a pass-through:
 * the watch surface renders inline in the AppShell content area exactly
 * like the original full-page layout  sidebar + top navbar stay where
 * they were, no portal, no Dialog chrome, no close button. The user
 * never sees that this is "a modal."
 *
 * Why keep the wrapper at all?
 *   - It's the single place to add intercepting-route behavior later
 *     (backgroundLocation rendering, transition animations, scroll
 *     preservation hooks) without touching every route file again.
 *   - `WatchLink` already attaches `state.backgroundLocation` on every
 *     navigation; once a root-level overlay strategy lands, this shell
 *     becomes the natural mount point for it.
 *
 * Until that future pass: render children inline, no extras.
 */

interface WatchModalShellProps {
  children: React.ReactNode;
  /**
   * Variant kept on the prop surface for future use. Currently a no-op
   *  the page renders inline regardless. `"page"` is the watch page,
   * `"sheet"` is the reel fullscreen-style sheet.
   */
  variant?: "page" | "sheet";
}

export default function WatchModalShell({ children }: WatchModalShellProps) {
  return <>{children}</>;
}
