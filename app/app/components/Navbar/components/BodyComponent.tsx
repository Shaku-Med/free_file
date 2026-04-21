import { useSidebar } from "~/components/ui/sidebar"
import Navbar from ".."
import Footer from "~/components/components/Footer"
import ScrollRestoration from "~/lib/Context/ScrollRestoration"
import { useFileContext } from "~/lib/Context/Context";
import { useLocation } from "react-router";
import { isPipChromeRoute } from "~/routes/pip/pipEnv";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ScrollState {
  state: boolean;
  opacityLevel: number;
}

interface BodyComponentProps {
  children: React.ReactNode
}

const staticRoutes = ["/", "/privacy", "/terms", "/features", "/auth", "/api", '/search', '/playlist', '/profile', '/subscriptions'];
const SCROLL_THRESHOLD = 300;

// Easing function — starts slow, accelerates, then eases into full opacity.
// Makes the transition feel natural instead of linear.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const BodyComponent = ({ children }: BodyComponentProps) => {
  const { isMobile, state } = useSidebar()
  const { theaterMode, hideAppChrome } = useFileContext();
  const location = useLocation();
  const suppressChrome = hideAppChrome || isPipChromeRoute(location.pathname);
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

  // Re-sync bar opacity when the route changes (e.g. scroll position restored).
  const handleScrollRef = useRef(handleScroll);
  handleScrollRef.current = handleScroll;
  useEffect(() => {
    handleScrollRef.current();
  }, [location.pathname]);

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
          <div className="sidebar_body h-full min-h-0 w-full min-w-0 flex-1">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-1 flex-col ${!isMobile && state === 'expanded' && 'pt-2'}`}
    >
      <div
        id="scroll_container"
        className={`${!isMobile && state === 'expanded' && 'rounded-tl-2xl bg-card shadow-sm'} min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-20`}
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <ScrollRestoration />
        <Navbar hasScrolled={hasScrolled} />
        <div
          className={`mx-auto w-full min-w-0 ${
            applyTheater ? 'max-w-none px-0' : 'max-w-[1600px] px-3 sm:px-5 lg:px-8 xl:px-10'
          } sidebar_body`}
        >
          {children}
        </div>
        <Footer />
      </div>
    </div>
  )
}

export default BodyComponent