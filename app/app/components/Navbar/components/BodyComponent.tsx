import { useSidebar } from "~/components/ui/sidebar"
import Navbar from ".."
import Footer from "~/components/components/Footer"
import ScrollRestoration from "~/lib/Context/ScrollRestoration"
import { useFileContext } from "~/lib/Context/Context";
import { useLocation } from "react-router";
import { useEffect, useRef } from "react";

interface BodyComponentProps {
  children: React.ReactNode
}

const staticRoutes = ["/", "/privacy", "/terms", "/features", "/auth", "/api", '/search', '/playlist'];

const BodyComponent = ({ children }: BodyComponentProps) => {
  const { isMobile, state } = useSidebar()
  const { theaterMode, setTheaterMode } = useFileContext();
  const location = useLocation();
  const theaterCacheRef = useRef<boolean>(false);

  useEffect(() => {
    const isStaticRoute = staticRoutes.some(route => 
      location.pathname === route || location.pathname.startsWith(route + '/')
    );

    if (isStaticRoute || isMobile) {
      theaterCacheRef.current = theaterMode;
      setTheaterMode(false);
    } else {
      if (theaterCacheRef.current) {
        setTheaterMode(true);
        theaterCacheRef.current = false;
      }
    }
  }, [location.pathname, isMobile]);

  return (
    <div className={`h-full w-full ${!isMobile && state === 'expanded' && `pt-3`}`}>
      <div 
        id="scroll_container" 
        className={`${!isMobile && state === 'expanded' && `rounded-tl-3xl bg-card`} h-full w-full overflow-y-auto overflow-x-hidden pb-20`}
      >
        <ScrollRestoration />
        <Navbar />
        <div className={`mx-auto ${theaterMode ? 'px-0' : 'px-6 xl:px-8'} sidebar_body w-full`}>
          {children}
        </div>
        <Footer />
      </div>
    </div>
  )
}

export default BodyComponent