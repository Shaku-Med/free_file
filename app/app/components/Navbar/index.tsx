import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { ArrowLeft, Plus, Search } from "lucide-react";
import Logo from "./Logo/Logo";
import { useFileContext } from "~/lib/Context/Context";
import { SidebarTrigger } from "../ui/sidebar";
import { UserProfileDropdown } from "~/components/UserProfileDropdown";
import { NavbarSearchBar } from "~/components/SearchDropdown/NavbarSearchBar";
import { useNavInlineSearch, useBodyContentWidth } from "~/lib/Context/BodyContentWidthContext";
import { useStandalone } from "~/lib/hooks/useStandalone";
import type { ScrollState } from "./components/BodyComponent";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { cn } from "~/lib/utils";

interface NavbarProps {
  hasScrolled?: ScrollState;
}

const iconBtn =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground/90 transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]";

export default function Navbar({ hasScrolled = { state: false, opacityLevel: 0 } }: NavbarProps) {
  const { setIsModalOpen, userId } = useFileContext();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const inlineSearch = useNavInlineSearch();
  const { bodyContentWidthPx } = useBodyContentWidth();
  const showCreateLabel = bodyContentWidthPx >= 720;
  const showMemoriesLabel = bodyContentWidthPx >= 420;
  const isReelRoute = location.pathname.startsWith("/reel");
  const isStandalone = useStandalone();

  const searchExpanded = mobileSearchOpen && !inlineSearch;
  const showSearchBar = !isReelRoute && (inlineSearch || mobileSearchOpen);
  const barOpacity = isReelRoute ? 0.92 : searchExpanded ? 1 : hasScrolled.opacityLevel;

  useEffect(() => {
    setMobileSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (inlineSearch) {
      setMobileSearchOpen(false);
    }
  }, [inlineSearch]);

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

  return (
    <header
      className={cn(
        "sticky top-0 z-[100000000] w-full shrink-0",
        isStandalone && "pt-[env(safe-area-inset-top)]",
      )}
      aria-label="Main"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 border-b border-border/40 bg-background/90 sm:bg-card/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 sm:supports-[backdrop-filter]:bg-card/75"
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
            <SidebarTrigger className={cn(iconBtn, "[&_svg]:size-5")} />
            {!isReelRoute ? (
              <Link
                to="/"
                id="home_button"
                className="group flex min-w-0 items-center gap-1 rounded-lg px-1 py-1 hover:bg-muted/60 sm:gap-1.5"
              >
                <Logo className="h-7 w-7 shrink-0 text-primary sm:h-8 sm:w-8" />
                <span
                  className={cn(
                    "truncate text-base font-bold tracking-tight text-foreground sm:text-lg",
                    !showMemoriesLabel && "sr-only",
                  )}
                >
                  Memories
                </span>
              </Link>
            ) : null}
          </div>
        )}

        {showSearchBar ? (
          <div
            className={cn(
              "min-w-0 flex-1",
              inlineSearch && "flex justify-center px-1 lg:px-6",
            )}
          >
            <NavbarSearchBar
              className={cn(inlineSearch ? "w-full max-w-[720px]" : "w-full")}
              autoFocus={searchExpanded}
              onClose={() => setMobileSearchOpen(false)}
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}

        {!searchExpanded ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            {!isReelRoute ? (
              <>
                {!inlineSearch && !mobileSearchOpen ? (
                  <button
                    type="button"
                    onClick={() => setMobileSearchOpen(true)}
                    className={iconBtn}
                    aria-label="Search"
                  >
                    <Search className="h-5 w-5" strokeWidth={2} />
                  </button>
                ) : null}

                {!inlineSearch ? (
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(true)}
                    className={iconBtn}
                    aria-label="Upload"
                  >
                    <Plus className="h-5 w-5" strokeWidth={2} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(true)}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-foreground/90 transition-colors hover:bg-muted/80"
                    aria-label="Upload"
                  >
                    <Plus className="h-5 w-5" strokeWidth={2} />
                    {showCreateLabel ? <span>Create</span> : null}
                  </button>
                )}
              </>
            ) : null}

            {userId ? (
              <NotificationsDropdown
                userId={userId}
                unreadCount={unreadCount}
                setUnreadCount={setUnreadCount}
                iconBtn={iconBtn}
              />
            ) : null}

            <UserProfileDropdown variant="topbar" />
          </div>
        ) : null}
      </div>
    </header>
  );
}
