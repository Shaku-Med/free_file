import { useMemo } from "react";
import { NavLink, Outlet, useLocation, redirect } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { cn } from "~/lib/utils";

// /brozystudio — secondary bar sticks under the main navbar.

// Gate the whole studio: signed-out users are bounced to login. Runs before
// every child route loader (RR nesting), so no studio page renders unauthed.
export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) {
    const url = new URL(request.url);
    return redirect(`/auth/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return null;
};

interface NavItem {
  to: string;
  label: string;
  shortLabel?: string;
  exact?: boolean;
}

const STUDIO_NAV: NavItem[] = [
  { to: "/brozystudio", label: "Home", exact: true },
  { to: "/brozystudio/posts", label: "Posts" },
  { to: "/brozystudio/analytics", label: "Analytics", shortLabel: "Stats" },
  { to: "/brozystudio/comments", label: "Comments", shortLabel: "Comments" },
  { to: "/brozystudio/inspiration", label: "Inspiration", shortLabel: "Ideas" },
];

/** Navbar `h-14` + optional standalone safe-area inset. */
const STUDIO_HEADER_STICKY_TOP = "calc(3.5rem + env(safe-area-inset-top, 0px))";

function StudioTab({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.exact}
      className={cn(
        "flex min-w-0 items-center justify-center border-b-2 px-1 py-2.5 text-center text-[11px] font-medium leading-tight transition-colors sm:px-2 sm:py-3 sm:text-sm",
        current
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:border-border/80 hover:text-foreground",
      )}
    >
      <span className="truncate sm:hidden">{item.shortLabel ?? item.label}</span>
      <span className="hidden truncate sm:inline">{item.label}</span>
    </NavLink>
  );
}

export default function StudioLayout() {
  const location = useLocation();

  const navItems = useMemo(() => {
    return STUDIO_NAV.map((item) => {
      const current = item.exact
        ? location.pathname === item.to
        : location.pathname === item.to ||
          location.pathname.startsWith(item.to + "/");
      return { item, current };
    });
  }, [location.pathname]);

  return (
    <div className="flex w-full min-w-0 flex-col">
      <header
        className={cn(
          "sticky z-[99999999] -mx-3 bg-background/95 backdrop-blur-md",
          "supports-[backdrop-filter]:bg-background/85 ",
        )}
        style={{ top: STUDIO_HEADER_STICKY_TOP }}
      >
        <div className="mx-auto w-full border-b border-border/50">

          <nav
            className="grid grid-cols-5 border-t border-border/40"
            aria-label="Studio sections"
          >
            {navItems.map(({ item, current }) => (
              <StudioTab key={item.to} item={item} current={current} />
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full flex-1 py-4 sm:py-6 sm:px-4 px-4">
        <Outlet />
      </main>
    </div>
  );
}
