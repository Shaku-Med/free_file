import { Link, useLocation } from "react-router";
import { SITE_NAME } from "~/lib/seo";

const Footer = () => {
  const location = useLocation();
  const staticRoutes = ["/", "/privacy", "/terms", "/features", "/auth", "/api"];
  const isSearchRoute =
    location.pathname === "/search" || location.pathname.startsWith("/search/");
  const isDynamicRoute =
    !staticRoutes.includes(location.pathname) &&
    location.pathname.startsWith("/") &&
    location.pathname.split("/").filter(Boolean).length === 1;
  const isBlacklisted = isSearchRoute || isDynamicRoute;

  if (isBlacklisted) return null;

  return (
    <footer className="border-t border-border bg-muted/30 mt-auto">
      <div className="mx-auto max-w-full xl:container px-3 py-6 sm:px-6 sm:py-8 xl:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 lg:gap-8">
          <nav
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-start sm:gap-x-6"
            aria-label="Footer navigation"
          >
            <Link
              to="/"
              className="py-2.5 px-1 -my-2.5 -mx-1 rounded text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Home
            </Link>
            <Link
              to="/privacy"
              className="py-2.5 px-1 -my-2.5 -mx-1 rounded text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Privacy
            </Link>
            <Link
              to="/terms"
              className="py-2.5 px-1 -my-2.5 -mx-1 rounded text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Terms
            </Link>
            <Link
              to="/features/incoming"
              className="py-2.5 px-1 -my-2.5 -mx-1 rounded text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Features
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground text-center sm:text-right sm:max-w-[280px] lg:max-w-md leading-relaxed">
            Uploads are permanent. Only share content you’re comfortable keeping on the platform.
          </p>
        </div>
        <div className="mt-5 pt-5 sm:mt-6 sm:pt-6 border-t border-border/60">
          <p className="text-xs text-muted-foreground text-center sm:text-left">
            © {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
