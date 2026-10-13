import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Home, Users, Plus, Film } from "lucide-react";
import { useSidebar } from "~/components/ui/sidebar";
import { useFileContext } from "~/lib/Context/Context";
import { UserProfileDropdown } from "~/components/UserProfileDropdown";
import PlatformTabBar, { type PlatformTab } from "~/components/PlatformTabBar";
import { HomeIcon, ReelIcon, SubsIcon } from "~/components/TabBarIcons";
import { useTabBarStyle } from "~/lib/hooks/useTabBarStyle";
import { openHeaderSearch } from "~/lib/headerSearch";
import { isReelRoute } from "~/lib/reelRoute";
import { isPipChromeRoute } from "~/routes/pip/pipEnv";
import { cn } from "~/lib/utils";

/** Space kept between a floating bar and anything docked above it (mini player, toasts). */
const FLOAT_GAP = 8;

type Item = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: Item[] = [
  { title: "Home", href: "/", icon: Home },
  { title: "Subs", href: "/subscriptions", icon: Users },
  { title: "Reel", href: "/reel", icon: Film },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileBottomNav() {
  const { isMobile } = useSidebar();
  const { pathname } = useLocation();
  const { setIsModalOpen, hideAppChrome } = useFileContext();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const style = useTabBarStyle();

  // Hide when the player goes browser-fullscreen (not covered by route checks).
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  // The app keeps its tab bar on Reels, with the reel ending above it; the
  // desktop-style bar still steps aside for the full height reel.
  const hidden =
    !isMobile ||
    hideAppChrome ||
    isFullscreen ||
    (style === "default" && isReelRoute(pathname)) ||
    isPipChromeRoute(pathname);

  // Publish how far the bar reaches up from the bottom edge so overlays (mini
  // player, toasts, the page's own bottom padding) can dock above it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (hidden || !bar) {
      root.style.removeProperty("--app-bottom-nav-h");
      return;
    }
    const gap = style === "ios-glass" ? FLOAT_GAP : 0;
    const publish = () => root.style.setProperty("--app-bottom-nav-h", `${bar.offsetHeight + gap}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-bottom-nav-h");
    };
  }, [hidden, bar, style]);

  if (hidden) return null;

  if (style !== "default") {
    const tabs: PlatformTab[] = [
      { title: "Home", href: "/", Icon: HomeIcon, active: isActive(pathname, "/") },
      { title: "Subs", href: "/subscriptions", Icon: SubsIcon, active: isActive(pathname, "/subscriptions") },
      { title: "Reels", href: "/reel", Icon: ReelIcon, active: isActive(pathname, "/reel") },
    ];
    return (
      <PlatformTabBar
        variant={style}
        tabs={tabs}
        profileActive={pathname.startsWith("/profile/")}
        searchActive={isActive(pathname, "/search")}
        onSearch={openHeaderSearch}
        barRef={setBar}
      />
    );
  }

  return (
    <nav
      aria-label="Primary"
      data-app-chrome=""
      ref={setBar}
      // Always reserve the home-indicator inset (env() is 0 on devices without one)
      // so the bar's background fills down to the true bottom edge  no black gap.
      className="fixed inset-x-0 bottom-0 z-[var(--z-app-chrome)] border-t border-border/60 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex h-14 items-stretch justify-around px-1">
        {navItems.slice(0, 2).map((item) => (
          <NavTab key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}

        <li className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            aria-label="Upload"
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95"
          >
            <Plus className="h-6 w-6" strokeWidth={2.2} />
          </button>
        </li>

        <NavTab item={navItems[2]} active={isActive(pathname, navItems[2].href)} />

        <li className="flex flex-1">
          <UserProfileDropdown variant="bottombar" />
        </li>
      </ul>
    </nav>
  );
}

function NavTab({ item, active }: { item: Item; active: boolean }) {
  return (
    <li className="flex flex-1">
      <Link
        to={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <item.icon className="h-[22px] w-[22px] fill-none stroke-current" />
        <span className="leading-none">{item.title}</span>
      </Link>
    </li>
  );
}
