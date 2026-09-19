import { useMemo, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, redirect } from "react-router";
import {
  BarChart3,
  Film,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Palette,
  Sparkles,
} from "lucide-react";
import { isAuthenticated } from "~/lib/Security/Password";
import { cn } from "~/lib/utils";

// /brozystudio — a rail on desktop, a scrolling pill bar on phones. Both stick
// under the app navbar so the current section is always visible.

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
  /** Phones only, where the pill bar has no room for the full word. */
  shortLabel?: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
}

const STUDIO_NAV: NavItem[] = [
  { to: "/brozystudio", label: "Home", icon: LayoutDashboard, exact: true },
  { to: "/brozystudio/posts", label: "Posts", icon: Film },
  { to: "/brozystudio/series", label: "Series", icon: Layers },
  { to: "/brozystudio/customization", label: "Customize", shortLabel: "Profile", icon: Palette },
  { to: "/brozystudio/analytics", label: "Analytics", shortLabel: "Stats", icon: BarChart3 },
  { to: "/brozystudio/comments", label: "Comments", icon: MessageSquare },
  { to: "/brozystudio/inspiration", label: "Inspiration", shortLabel: "Ideas", icon: Sparkles },
];

/** Navbar `h-14` plus the standalone window's safe area. */
const STICKY_TOP = "calc(3.5rem + env(safe-area-inset-top, 0px))";

function RailLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.exact}
      aria-current={current ? "page" : undefined}
      // Icon only until there is room for the label, so the rail never squeezes
      // the page beside it on a laptop.
      className={cn(
        "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors xl:px-3",
        "justify-center xl:justify-start",
        current
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="hidden truncate xl:inline">{item.label}</span>
      <span className="sr-only xl:hidden">{item.label}</span>
    </NavLink>
  );
}

function PillLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.exact}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
        current
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {item.shortLabel ?? item.label}
    </NavLink>
  );
}

export default function StudioLayout() {
  const location = useLocation();

  const navItems = useMemo(() => {
    return STUDIO_NAV.map((item) => {
      const current = item.exact
        ? location.pathname === item.to
        : location.pathname === item.to || location.pathname.startsWith(item.to + "/");
      return { item, current };
    });
  }, [location.pathname]);

  return (
    // items-start so the rail's sticky positioning has somewhere to travel;
    // a stretched flex child is already full height and would never stick.
    <div className="mx-auto flex w-full min-w-0 max-w-[1600px] items-start gap-0 px-2 sm:px-4 lg:gap-6 lg:px-6">
      <aside
        className="sticky z-20 hidden shrink-0 self-start lg:block"
        style={{ top: `calc(${STICKY_TOP} + 1rem)` }}
        aria-label="Studio sections"
      >
        <nav className="flex w-[3.25rem] flex-col gap-1 xl:w-[13.5rem]">
          <p className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground xl:block">
            Studio
          </p>
          {navItems.map(({ item, current }) => (
            <RailLink key={item.to} item={item} current={current} />
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <div
          className="sticky z-30 border-b border-border/50 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 lg:hidden"
          style={{ top: STICKY_TOP }}
        >
          <nav
            aria-label="Studio sections"
            // Horizontal scroll rather than seven squeezed columns: labels stay
            // whole instead of truncating to "Insp…".
            className="flex gap-1 overflow-x-auto py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {navItems.map(({ item, current }) => (
              <PillLink key={item.to} item={item} current={current} />
            ))}
          </nav>
        </div>

        {/* isolate, not a bigger z-index: cards inside carry z-[1000000] of
            their own, and without a stacking context here they paint straight
            over the nav above them. Isolating keeps those values local so a
            plain z-30 on the bar is enough to stay on top. */}
        <main className="isolate min-w-0 py-5 sm:py-6 lg:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
