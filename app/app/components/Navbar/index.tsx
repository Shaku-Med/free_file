import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Search, Plus, Bell } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "~/components/ui/navigation-menu";
import Logo from "./Logo/Logo";
import { useFileContext } from "~/lib/Context/Context";
import { SidebarTrigger, useSidebar } from "../ui/sidebar";
import { UserProfileDropdown } from "~/components/UserProfileDropdown";
import { SearchModal } from "~/components/SearchModal";
import { useStandalone } from "~/lib/hooks/useStandalone";

const galleryCategories = [
  { name: "Portraits", href: "/gallery/portraits" },
  { name: "Landscapes", href: "/gallery/landscapes" },
  { name: "Street", href: "/gallery/street" },
  { name: "Wedding", href: "/gallery/wedding" },
  { name: "Events", href: "/gallery/events" },
  { name: "Commercial", href: "/gallery/commercial" },
];


import type { ScrollState } from "./components/BodyComponent";

interface NavbarProps {
  hasScrolled?: ScrollState;
}

export default function Navbar({ hasScrolled = { state: false, opacityLevel: 0 } }: NavbarProps) {
  const { setIsModalOpen, userId } = useFileContext();
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { isMobile, state } = useSidebar();
  const location = useLocation();
  const isReelRoute = location.pathname.startsWith("/reel");
  const isStandalone = useStandalone();

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
      className={`sticky top-[env(safe-area-inset-top)] z-[100000000] w-full relative ${isStandalone ? "pt-env(safe-area-inset-top)" : ""} ${
        isReelRoute
          ? "bg-transparent border-none shadow-none"
          : "bg-transparent"
      }`}
    >
      <div
        className="background_scroll absolute inset-0 bg-card shadow-lg border-b transition-opacity duration-200 ease-out pointer-events-none"
        style={{ opacity: hasScrolled.opacityLevel }}
      />
      <div className="relative mx-auto px-3 sm:px-6 xl:px-8 min-w-0">
        <div className={`flex py-2 sm:py-3 items-center gap-2 min-w-0 ${isReelRoute ? "justify-end" : "justify-between"}`}>
          {!isReelRoute && (
            <div className="flex items-center min-w-0 shrink-0">
              <Link to="/" id="home_button" className="flex items-center gap-1.5 sm:gap-2 group min-w-0">
                <Logo className="relative h-8 w-8 sm:h-10 sm:w-10 text-primary shrink-0" />
                <span className="text-base sm:text-xl font-bold text-primary truncate">
                  Memories
                </span>
              </Link>
            </div>
          )}

          <div className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink-0">
             <div onClick={() => setIsModalOpen(true)} className="cursor-pointer rounded-lg h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center hover:bg-primary/10 ios-scale shrink-0">
                  <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
             </div>
             <button
               type="button"
               onClick={() => setSearchModalOpen(true)}
               className="cursor-pointer rounded-lg h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center hover:bg-primary/10 ios-scale shrink-0"
               aria-label="Search"
             >
               <Search className="h-4 w-4 sm:h-5 sm:w-5" />
             </button>
             <SearchModal open={searchModalOpen} onOpenChange={setSearchModalOpen} />
             {userId ? (
               <Link to="/notifications" className="relative cursor-pointer rounded-lg h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center hover:bg-primary/10 ios-scale shrink-0">
                 <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
                 {unreadCount > 0 && (
                   <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                     {unreadCount > 99 ? "99+" : unreadCount}
                   </span>
                 )}
               </Link>
             ) : null}
             <UserProfileDropdown variant="topbar" />
             <SidebarTrigger className="cursor-pointer rounded-lg h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center hover:bg-primary/10 ios-scale shrink-0"/>
          </div>

          
        </div>
      </div>
    </nav>
  );
}