import { useSidebar } from "~/components/ui/sidebar"
import Navbar from ".."
import Footer from "~/components/components/Footer"
import ScrollRestoration from "~/lib/Context/ScrollRestoration"
import { useFileContext } from "~/lib/Context/Context";
import { useLocation } from "react-router";
import { useCallback, useMemo, useRef, useState } from "react";

export interface ScrollState {
  state: boolean;
  opacityLevel: number;
}

interface BodyComponentProps {
  children: React.ReactNode
}

const staticRoutes = ["/", "/privacy", "/terms", "/features", "/auth", "/api", '/search', '/playlist', '/profile'];
const SCROLL_THRESHOLD = 300;

// Easing function — starts slow, accelerates, then eases into full opacity.
// Makes the transition feel natural instead of linear.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const BodyComponent = ({ children }: BodyComponentProps) => {
  const { isMobile, state } = useSidebar()
  const { theaterMode } = useFileContext();
  const location = useLocation();
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

  return (
    <div className={`h-full w-full ${!isMobile && state === 'expanded' && `pt-3`}`}>
      <div 
        id="scroll_container" 
        className={`${!isMobile && state === 'expanded' && `rounded-tl-3xl bg-card`} h-full w-full overflow-y-auto overflow-x-hidden pb-20`}
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <ScrollRestoration />
        <Navbar hasScrolled={hasScrolled} />
        <div className={`mx-auto ${applyTheater ? 'px-0' : 'px-6 xl:px-8'} sidebar_body w-full`}>
          {children}
        </div>
        <Footer />
      </div>
    </div>
  )
}

export default BodyComponent