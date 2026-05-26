import { useSidebar } from "~/components/ui/sidebar"
import Navbar from ".."
import Footer from "~/components/components/Footer"
import ScrollRestoration from "~/lib/Context/ScrollRestoration"
import { useFileContext } from "~/lib/Context/Context";
import { useLocation } from "react-router";
import { isPipChromeRoute } from "~/routes/pip/pipEnv";
import { isReelRoute } from "~/lib/reelRoute";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import PersistentHomeView from "~/routes/Home/PersistentHomeView";

export interface ScrollState {
  state: boolean;
  opacityLevel: number;
}

interface BodyComponentProps {
  children: React.ReactNode
}

const staticRoutes = ["/", "/privacy", "/terms", "/dmca", "/community-guidelines", "/features", "/auth", "/api", '/search', '/playlist', '/profile', '/subscriptions'];
const SCROLL_THRESHOLD = 300;

// Easing function  starts slow, accelerates, then eases into full opacity.
// Makes the transition feel natural instead of linear.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const BodyComponent = ({ children }: BodyComponentProps) => {
  const { isMobile, state, sheetOnly } = useSidebar()
  const { theaterMode, hideAppChrome } = useFileContext();
  const location = useLocation();
  const suppressChrome = hideAppChrome || isPipChromeRoute(location.pathname);
  const onReelRoute = isReelRoute(location.pathname);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [hasScrolled, setHasScrolled] = useState<ScrollState>({
    state: false,
    opacityLevel: 0,
  });

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const y = el.scrollTop;
    const rawProgress = Math.min(y / SCROLL_THRESHOLD, 1);
    const opacityLevel = Math.round(easeOutCubic(rawProgress) * 100) / 100;
    setHasScrolled(prev => {
      const next = y > 0;
      if (prev.state === next && prev.opacityLevel === opacityLevel) return prev;
      return { state: next, opacityLevel };
    });
  }, []);

  const isStaticRoute = useMemo(() =>
    staticRoutes.some(route =>
      location.pathname === route || location.pathname.startsWith(route + '/')
    ),
    [location.pathname]
  );

  const applyTheater = theaterMode && !isStaticRoute;
  const sidebarExpandedLayout = !isMobile && state === "expanded" && !sheetOnly;

  // Re-sync bar opacity after navigation (after ScrollRestoration may have applied scroll).
  const handleScrollRef = useRef(handleScroll);
  handleScrollRef.current = handleScroll;
  useLayoutEffect(() => {
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => handleScrollRef.current());
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, [location.pathname, location.search]);

  // The Home feed lives in `<PersistentHomeView />` here  mounted ONCE
  // inside the scroll container and visibility-toggled by pathname.
  // When the URL is `/`, the persistent view is visible and `children`
  // (the matched route, which is a no-op marker for `/`) renders null.
  // For any other route, the persistent view is hidden via `display:none`
  // so its DOM, refs, and observers stay alive  closing a watch / reel
  // modal returns the user to a feed that NEVER unmounted, preserving
  // scroll position and all client state.
  const isHomeRoute = location.pathname === "/";

  if (suppressChrome) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <div
          id="scroll_container"
          className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          ref={scrollContainerRef}
          onScroll={handleScroll}
        >
          <ScrollRestoration />
          <div className="sidebar_body h-full min-h-0 w-full min-w-0 flex-1">
            <div style={{ display: isHomeRoute ? "block" : "none" }} aria-hidden={!isHomeRoute}>
              <PersistentHomeView />
            </div>
            <div style={{ display: isHomeRoute ? "none" : "block" }}>{children}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-1 flex-col ${sidebarExpandedLayout && "pt-2"}`}
    >
      <div
        id="scroll_container"
        className={`${sidebarExpandedLayout && "rounded-tl-2xl bg-card shadow-sm"} min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden ${onReelRoute ? "overflow-hidden pb-0" : "pb-20"}`}
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <ScrollRestoration />
        <Navbar hasScrolled={hasScrolled} />
        <div
          className={`mx-auto w-full min-w-0 flex-1 ${
            applyTheater || onReelRoute
              ? "max-w-none px-0"
              : " px-3 sm:px-5 lg:px-8 xl:px-4"
          } sidebar_body`}
        >
          <div style={{ display: isHomeRoute ? "block" : "none" }} aria-hidden={!isHomeRoute}>
            <PersistentHomeView />
          </div>
          <div style={{ display: isHomeRoute ? "none" : "block" }}>{children}</div>
        </div>
        {!onReelRoute ? <Footer /> : null}
      </div>
    </div>
  )
}

export default BodyComponent
