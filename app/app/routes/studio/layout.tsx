import { useMemo, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation, redirect } from "react-router";
import {
  BarChart3,
  Film,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Palette,
  Settings,
  Sparkles,
  SquareArrowOutUpRight,
} from "lucide-react";
import { isAuthenticated } from "~/lib/Security/Password";
import { useFileContext } from "~/lib/Context/Context";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
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
  { to: "/brozystudio", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/brozystudio/posts", label: "Content", icon: Film },
  { to: "/brozystudio/series", label: "Series", icon: Layers },
  { to: "/brozystudio/analytics", label: "Analytics", shortLabel: "Stats", icon: BarChart3 },
  { to: "/brozystudio/comments", label: "Comments", icon: MessageSquare },
  { to: "/brozystudio/customization", label: "Customization", shortLabel: "Customize", icon: Palette },
  { to: "/brozystudio/inspiration", label: "Inspiration", shortLabel: "Ideas", icon: Sparkles },
];

/** The rail's quieter bottom group: ways out of the studio. */
const RAIL_FOOTER: NavItem[] = [{ to: "/settings", label: "Settings", icon: Settings }];

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

/** Who the studio belongs to, the first thing in the rail. */
function ChannelBadge() {
  const { userProfile, userProfileLoading } = useFileContext();
  const username = userProfile?.username ?? "";
  const avatar = (
    <Avatar className="h-9 w-9 transition-[width,height] duration-200 xl:h-20 xl:w-20">
      <AvatarImage src={getProfilePicUrl(userProfile?.profile_pic ?? undefined)} alt="" />
      <AvatarFallback className="bg-muted text-sm font-medium text-muted-foreground xl:text-2xl">
        {userProfileLoading ? "" : (username.charAt(0) || "?").toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
  const text = (
    <span className="hidden min-w-0 max-w-full xl:block">
      <span className="block text-sm font-semibold text-foreground">Your channel</span>
      <span className="block truncate text-xs text-muted-foreground">
        {username || (userProfileLoading ? " " : "")}
      </span>
    </span>
  );
  const shell = "flex flex-col items-center gap-2.5 rounded-xl px-1 py-2 text-center xl:px-3 xl:py-4";

  if (!username) {
    return (
      <div className={shell}>
        {avatar}
        {text}
      </div>
    );
  }
  return (
    <Link
      to={`/profile/${encodeURIComponent(username)}`}
      className={cn(shell, "transition-colors hover:bg-accent/50")}
      aria-label="View your channel"
    >
      {avatar}
      {text}
    </Link>
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

function ViewChannelLink() {
  const { userProfile } = useFileContext();
  if (!userProfile?.username) return null;
  return (
    <RailLink
      item={{
        to: `/profile/${encodeURIComponent(userProfile.username)}`,
        label: "View channel",
        icon: SquareArrowOutUpRight,
      }}
      current={false}
    />
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
        className="sticky z-20 hidden shrink-0 self-start overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden"
        style={{
          top: `calc(${STICKY_TOP} + 1rem)`,
          // Short laptop screens: the rail scrolls on its own instead of
          // hanging off the bottom.
          maxHeight: `calc(100dvh - ${STICKY_TOP} - 2rem)`,
        }}
      >
        <div className="flex w-[3.25rem] flex-col xl:w-[13.5rem]">
          <ChannelBadge />
          <nav className="mt-2 flex flex-col gap-1" aria-label="Studio sections">
            {navItems.map(({ item, current }) => (
              <RailLink key={item.to} item={item} current={current} />
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-1 border-t border-border/50 pt-3">
            {RAIL_FOOTER.map((item) => (
              <RailLink key={item.to} item={item} current={false} />
            ))}
            <ViewChannelLink />
          </div>
        </div>
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
