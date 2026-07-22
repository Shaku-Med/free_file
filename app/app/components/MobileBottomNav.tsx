import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Home, Users, Plus, Film } from "lucide-react";
import { useSidebar } from "~/components/ui/sidebar";
import { useFileContext } from "~/lib/Context/Context";
import { UserProfileDropdown } from "~/components/UserProfileDropdown";
import { isReelRoute } from "~/lib/reelRoute";
import { isPipChromeRoute } from "~/routes/pip/pipEnv";
import { cn } from "~/lib/utils";

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

  const hidden =
    !isMobile ||
    hideAppChrome ||
    isFullscreen ||
    isReelRoute(pathname) ||
    isPipChromeRoute(pathname);

  // Publish bar height so overlays (mini player) can dock above it.
  useEffect(() => {
    const root = document.documentElement;
    if (hidden) {
      root.style.removeProperty("--app-bottom-nav-h");
      return;
    }
    return () => {
      root.style.removeProperty("--app-bottom-nav-h");
    };
  }, [hidden]);

  if (hidden) return null;

  return (
    <nav
      aria-label="Primary"
      data-app-chrome=""
      ref={(el) => {
        if (el) document.documentElement.style.setProperty("--app-bottom-nav-h", `${el.offsetHeight}px`);
      }}
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
