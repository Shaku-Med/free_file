import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Search, Plus, Bell } from "lucide-react";
import Logo from "./Logo/Logo";
import { useFileContext } from "~/lib/Context/Context";
import { SidebarTrigger } from "../ui/sidebar";
import { UserProfileDropdown } from "~/components/UserProfileDropdown";
import { SearchModal } from "~/components/SearchModal";
import { useStandalone } from "~/lib/hooks/useStandalone";
import type { ScrollState } from "./components/BodyComponent";
import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";

interface NavbarProps {
  hasScrolled?: ScrollState;
}

const iconBtn =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-background/90 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.96] dark:hover:bg-white/10 sm:h-9 sm:w-9";

export default function Navbar({ hasScrolled = { state: false, opacityLevel: 0 } }: NavbarProps) {
  const { setIsModalOpen, userId } = useFileContext();
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const isReelRoute = location.pathname.startsWith("/reel");
  const isStandalone = useStandalone();
  const C_IsMobile = useIsMobile();

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    fetch("/api/notifications?count=1")
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
    <nav
      className={cn(
        "sticky top-0 z-[100000000] w-full shrink-0",
        isStandalone && "pt-[env(safe-area-inset-top)]",
        isReelRoute ? "border-none shadow-none" : ""
      )}
      aria-label="Main"
    >
      <div className="relative">
        {/* Fades in as you scroll — driven by #scroll_container in BodyComponent */}
        <div
          className={cn(
            "background_scroll pointer-events-none absolute inset-0 border-b shadow-lg transition-opacity duration-200 ease-out",
            C_IsMobile ? "bg-background" : "bg-card"
          )}
          style={{ opacity: hasScrolled.opacityLevel }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-[1600px] min-w-0 px-3 sm:px-5 lg:px-8">
        <div
          className={cn(
            "flex min-w-0 items-center gap-3 py-2.5 sm:py-3.5",
            isReelRoute ? "justify-end" : "justify-between"
          )}
        >
          {!isReelRoute && (
            <div className="flex min-w-0 shrink-0 items-center">
              <Link
                to="/"
                id="home_button"
                className="group flex min-w-0 items-center gap-1.5 sm:gap-2"
              >
                <Logo className="h-8 w-8 shrink-0 text-primary sm:h-10 sm:w-10" />
                <span className="hidden truncate text-base font-bold text-primary sm:block sm:text-xl">
                  Memories
                </span>
              </Link>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div
              className={cn(
                "flex items-center gap-0.5 rounded-full border p-0.5 shadow-sm",
                "border-border/50 bg-muted/35 backdrop-blur-sm",
                "dark:border-white/[0.08] dark:bg-muted/20"
              )}
            >
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className={iconBtn}
                title="Upload"
                aria-label="Upload"
              >
                <Plus className="h-[1.05rem] w-[1.05rem] sm:h-[1.15rem] sm:w-[1.15rem]" strokeWidth={2.25} />
              </button>
              <button
                type="button"
                onClick={() => setSearchModalOpen(true)}
                className={iconBtn}
                title="Search"
                aria-label="Search"
              >
                <Search className="h-[1.05rem] w-[1.05rem] sm:h-[1.15rem] sm:w-[1.15rem]" strokeWidth={2.25} />
              </button>
              <SearchModal open={searchModalOpen} onOpenChange={setSearchModalOpen} />
              {userId ? (
                <Link
                  to="/notifications"
                  className={cn(iconBtn, "relative")}
                  title="Notifications"
                  aria-label="Notifications"
                >
                  <Bell className="h-[1.05rem] w-[1.05rem] sm:h-[1.15rem] sm:w-[1.15rem]" strokeWidth={2.25} />
                  {unreadCount > 0 ? (
                    <span className="absolute right-0.5 top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background dark:ring-card">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </Link>
              ) : null}
            </div>

            <div className="hidden h-7 w-px shrink-0 bg-border/50 sm:block" aria-hidden />

            <div className="flex items-center gap-1 sm:gap-1.5">
              <UserProfileDropdown variant="topbar" />
              <SidebarTrigger
                className={cn(
                  iconBtn,
                  "[&_svg]:size-[1.05rem] sm:[&_svg]:size-[1.15rem]"
                )}
              />
            </div>
          </div>
        </div>
        </div>
      </div>
    </nav>
  );
}
