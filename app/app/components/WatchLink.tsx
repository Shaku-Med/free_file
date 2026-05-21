/**
 * WatchLink.tsx
 *
 * Drop-in replacement for `<Link>` that attaches the user's current
 * location as `state.backgroundLocation` on the navigation. The watch
 * modal shell already opens regardless of how the user arrived; this
 * extra state is what a future "true intercepting routes" pass will use
 * to keep the previous page mounted underneath while the modal is open.
 *
 * Until that pass lands, behavior is identical to a normal Link — no
 * regressions, just future-proofing every call site so we don't have to
 * touch them again.
 *
 * Usage:
 *   <WatchLink to={fileWatchPath(file)}>...</WatchLink>
 *   <WatchLink to={`/reel/${id}`} replace>...</WatchLink>
 *
 * Anything you'd pass to <Link> works — `to`, `replace`, `prefetch`,
 * children, className, onClick, etc. The only behavioral change is the
 * `state` is overridden with `{ backgroundLocation, ...yourState }`.
 */

import { forwardRef, useMemo } from "react";
import { Link, useLocation, type LinkProps } from "react-router";

export type WatchLinkProps = LinkProps;

const WatchLink = forwardRef<HTMLAnchorElement, WatchLinkProps>(
  function WatchLink({ state, ...rest }, ref) {
    const location = useLocation();

    // Snapshot the *outgoing* location into state. We only capture
    // pathname/search/hash — passing the full history `state` object
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

    return <Link ref={ref} state={mergedState} {...rest} />;
  },
);

export default WatchLink;
