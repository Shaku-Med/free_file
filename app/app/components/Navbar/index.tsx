import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { ArrowLeft, Plus, Search } from "lucide-react";
import Logo from "./Logo/Logo";
import { useFileContext } from "~/lib/Context/Context";
import { SidebarTrigger, useSidebar } from "../ui/sidebar";
import { UserProfileDropdown } from "~/components/UserProfileDropdown";
import { NavbarSearchBar } from "~/components/SearchDropdown/NavbarSearchBar";
import { useNavInlineSearch, useBodyContentWidth } from "~/lib/Context/BodyContentWidthContext";
import { useStandalone } from "~/lib/hooks/useStandalone";
import type { ScrollState } from "./components/BodyComponent";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { cn } from "~/lib/utils";
import { isReelRoute } from "~/lib/reelRoute";

interface NavbarProps {
  hasScrolled?: ScrollState;
}

const iconBtn =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground/90 transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]";

const iconBtnReel =
  "text-white/95 hover:bg-white/12 focus-visible:ring-white/40";

function getProfileUsernameFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/profile\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export default function Navbar({ hasScrolled = { state: false, opacityLevel: 0 } }: NavbarProps) {
  const { userId, setIsModalOpen } = useFileContext();
  const { isMobile, state, sheetOnly } = useSidebar();
  // When the rail is expanded the content area becomes a card surface, so the
  // bar matches it (bg-card); otherwise it sits on the plain background.
  const expandedDesktop = !isMobile && !sheetOnly && state === "expanded";
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const inlineSearch = useNavInlineSearch();
  const { bodyContentWidthPx } = useBodyContentWidth();
  const showMemoriesLabel = bodyContentWidthPx >= 420;
  const onReelRoute = isReelRoute(location.pathname);
  const isStandalone = useStandalone();
  const profileUsername = useMemo(
    () => getProfileUsernameFromPath(location.pathname),
    [location.pathname],
  );

  // On reels we never use the inline (desktop) search bar — it would cover the video.
  // Force the icon → expand flow at every screen size there.
  const effectiveInlineSearch = inlineSearch && !onReelRoute;

  const searchExpanded = mobileSearchOpen && !effectiveInlineSearch;
  // Search stays available on reels too (just over the video).
  const showSearchBar = effectiveInlineSearch || mobileSearchOpen;
  // Reel keeps a transparent bar, but give a backdrop while the search is expanded
  // so the field stays readable against the video.
  const barOpacity = searchExpanded ? 1 : onReelRoute ? 0 : hasScrolled.opacityLevel;

  useEffect(() => {
    setMobileSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (effectiveInlineSearch) {
      setMobileSearchOpen(false);
    }
  }, [effectiveInlineSearch]);

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    fetch("/api/notifications?count=1", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.success && typeof d.unreadCount === "number") setUnreadCount(d.unreadCount);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, location.pathname]);

  // Drop the published height when the navbar unmounts so stale offsets don't
  // linger on routes that render no navbar.
  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("--app-top-nav-h");
    };
  }, []);

  return (
    <header
      ref={(el) => {
        // Publish the bar height so fullscreen overlays (e.g. the reel deck,
        // which sits BELOW the navbar in z-order) can keep their chrome out
        // from under it. Cleared on unmount by the effect above.
        if (el) {
          document.documentElement.style.setProperty("--app-top-nav-h", `${el.offsetHeight}px`);
        }
      }}
      className={cn(
        "sticky top-0 z-[var(--z-app-chrome)] w-full shrink-0",
        isStandalone && "pt-[env(safe-area-inset-top)]",
      )}
      aria-label="Main"
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 border-b border-border/40 backdrop-blur-md",
          expandedDesktop
            ? "bg-card/90 supports-[backdrop-filter]:bg-card/75"
            : "bg-background/90 supports-[backdrop-filter]:bg-background/75",
        )}
        style={{ opacity: barOpacity }}
      />
      <div className="relative z-10 mx-auto flex h-14 min-w-0 items-center gap-1 px-2 sm:px-4">
        {searchExpanded ? (
          <button
            type="button"
            className={iconBtn}
            aria-label="Close search"
            onClick={() => setMobileSearchOpen(false)}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            <SidebarTrigger className={cn(iconBtn, onReelRoute && iconBtnReel, "[&_svg]:size-5")} />
            {/* Logo lives in the sidebar on desktop; topbar carries it only on mobile (sheet nav). */}
            {isMobile && !onReelRoute ? (
              profileUsername ? (
                <Link
                  to={`/profile/${encodeURIComponent(profileUsername)}`}
                  className="group flex min-w-0 max-w-[min(52vw,11rem)] items-center rounded-lg px-1 py-1 hover:bg-muted/60 sm:max-w-[min(40vw,14rem)]"
                  aria-label={`${profileUsername}'s profile`}
                >
                  <span className="truncate text-base font-bold tracking-tight text-foreground sm:text-lg">
                    {profileUsername}
                  </span>
                </Link>
              ) : (
                <Link
                  to="/"
                  id="home_button"
                  className="group flex min-w-0 items-center gap-1 rounded-lg px-1 py-1 hover:bg-muted/60 sm:gap-1.5"
                >
                  <Logo className="h-7 w-7 shrink-0 text-primary sm:h-8 sm:w-8 ml-[-5px]" />
                  <span
                    className={cn(
                      "truncate text-base font-bold tracking-tight text-foreground sm:text-lg",
                      !showMemoriesLabel && "sr-only",
                    )}
                  >
                    Memories
                  </span>
                </Link>
              )
            ) : null}
          </div>
        )}

        {showSearchBar ? (
          <div
            className={cn(
              "min-w-0 flex-1",
              effectiveInlineSearch && "flex justify-center px-1 lg:px-6",
            )}
          >
            <NavbarSearchBar
              className={cn(effectiveInlineSearch ? "w-full max-w-[720px]" : "w-full")}
              autoFocus={searchExpanded}
              onClose={() => setMobileSearchOpen(false)}
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}

        {!searchExpanded ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            {/* Search  available everywhere, including reels (white icon on the video). */}
            {!effectiveInlineSearch && !mobileSearchOpen ? (
              <button
                type="button"
                onClick={() => setMobileSearchOpen(true)}
                className={cn(iconBtn, onReelRoute && iconBtnReel)}
                aria-label="Search"
              >
                <Search className="h-5 w-5" strokeWidth={2} />
              </button>
            ) : null}

            {/* Create  topbar is the single home on desktop; mobile uses the tab bar. */}
            {!onReelRoute && !isMobile ? (
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
                aria-label="Create"
              >
                <Plus className="h-4 w-4" strokeWidth={2.2} />
                <span>Create</span>
              </button>
            ) : null}

            {userId ? (
              <NotificationsDropdown
                userId={userId}
                unreadCount={unreadCount}
                setUnreadCount={setUnreadCount}
                iconBtn={iconBtn}
              />
            ) : null}

            {/* Profile / Sign in  desktop only; mobile uses the tab bar. */}
            {!isMobile ? <UserProfileDropdown variant="topbar" /> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
