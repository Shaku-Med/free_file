/**
 * WatchLink.tsx
 *
 * Drop-in replacement for `<Link>` that attaches the user's current
 * location as `state.backgroundLocation` on the navigation, and makes
 * watch→watch navigation fast by preflighting the destination:
 *
 *   - pointerdown / click  pre-mints the playback URL (POST /api/play/mint)
 *     so the mint round-trip runs in PARALLEL with the route loader instead
 *     of after it. The watch page's usePlaybackUrl finds it in the cache on
 *     first render and HLS starts immediately.
 *   - 150ms sustained mouse hover (real intent, not grid-scanning)  also
 *     prefetches the destination's loader data + route modules via
 *     <PrefetchPageLinks>, and pre-mints, so a deliberate click lands on a
 *     page that's already local.
 *
 * Security is unchanged: the mint endpoint replays full access control and
 * the token stays IP+UA+nonce bound  we only call it earlier, from the
 * same browser that will play the video.
 *
 * Usage:
 *   <WatchLink to={fileWatchPath(file)}>...</WatchLink>
 *   <WatchLink to={`/reel/${id}`} replace>...</WatchLink>
 *
 * Anything you'd pass to <Link> works  `to`, `replace`, `prefetch`,
 * children, className, onClick, etc. The only behavioral change is the
 * `state` is overridden with `{ backgroundLocation, ...yourState }`.
 */

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Link, PrefetchPageLinks, useLocation, type LinkProps } from "react-router";
import { preflightPlayback } from "~/lib/playbackUrlCache";
import { isSingleSegmentWatchPath } from "~/lib/Context/MiniPlayerContext";

export type WatchLinkProps = LinkProps;

/** Sustained-hover ms that counts as navigation intent (filters mouse fly-bys). */
const HOVER_INTENT_MS = 150;

/** File id when `to` is an absolute single-segment watch path; null otherwise. */
function watchFileIdFromTo(to: LinkProps["to"]): string | null {
  const pathname = typeof to === "string" ? to : to?.pathname ?? "";
  if (!pathname.startsWith("/")) return null;
  const path = pathname.split(/[?#]/)[0] ?? "";
  if (!isSingleSegmentWatchPath(path)) return null;
  return path.replace(/^\/+|\/+$/g, "");
}

const WatchLink = forwardRef<HTMLAnchorElement, WatchLinkProps>(
  function WatchLink(
    { state, onPointerEnter, onPointerLeave, onPointerDown, onClick, ...rest },
    ref,
  ) {
    const location = useLocation();
    const watchFileId = useMemo(() => watchFileIdFromTo(rest.to), [rest.to]);
    const [hoverIntent, setHoverIntent] = useState(false);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
      () => () => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      },
      [],
    );

    // Snapshot the *outgoing* location into state. We only capture
    // pathname/search/hash  passing the full history `state` object
    // would create a cyclic reference if the user click-trails through
    // multiple modal opens.
    const mergedState = useMemo(
      () => ({
        backgroundLocation: {
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        },
        ...(state && typeof state === "object" ? state : {}),
      }),
      [location.pathname, location.search, location.hash, state],
    );

    const preflight = () => {
      if (watchFileId) preflightPlayback(watchFileId);
    };

    return (
      <>
        <Link
          ref={ref}
          state={mergedState}
          {...rest}
          onPointerEnter={(e) => {
            // Mouse only: touch fires pointerenter mid-tap, when the real
            // navigation (and its pointerdown preflight) is already going.
            if (
              watchFileId &&
              e.pointerType === "mouse" &&
              !hoverIntent &&
              hoverTimerRef.current == null
            ) {
              hoverTimerRef.current = setTimeout(() => {
                hoverTimerRef.current = null;
                setHoverIntent(true);
                preflight();
              }, HOVER_INTENT_MS);
            }
            onPointerEnter?.(e);
          }}
          onPointerLeave={(e) => {
            if (hoverTimerRef.current) {
              clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = null;
            }
            onPointerLeave?.(e);
          }}
          onPointerDown={(e) => {
            preflight();
            onPointerDown?.(e);
          }}
          onClick={(e) => {
            // Also covers keyboard navigation (Enter fires click only).
            preflight();
            onClick?.(e);
          }}
        />
        {hoverIntent && watchFileId ? (
          <PrefetchPageLinks page={`/${watchFileId}`} />
        ) : null}
      </>
    );
  },
);

export default WatchLink;
