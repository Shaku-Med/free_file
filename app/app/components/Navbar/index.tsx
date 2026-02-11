import { useState } from "react";
import { Link, useLocation } from "react-router";
import { 
  Camera, 
  Menu, 
  X, 
  Search, 
  User, 
  Heart, 
  ShoppingCart, 
  Filter,
  Grid3X3,
  List,
  Settings,
  LogOut,
  ChevronRight,
  Plus,
  MenuIcon,
  Hamburger
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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

const galleryCategories = [
  { name: "Portraits", href: "/gallery/portraits" },
  { name: "Landscapes", href: "/gallery/landscapes" },
  { name: "Street", href: "/gallery/street" },
  { name: "Wedding", href: "/gallery/wedding" },
  { name: "Events", href: "/gallery/events" },
  { name: "Commercial", href: "/gallery/commercial" },
];

const userMenuItems = [
  { name: "Profile", href: "/profile", icon: User },
  { name: "Favorites", href: "/favorites", icon: Heart },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Navbar() {
  const { setIsModalOpen } = useFileContext();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // const [input, setInput] = useState<string>("");
  const { isMobile, state } = useSidebar();
  const location = useLocation();
  const isReelRoute = location.pathname.startsWith("/reel");

  return (
    <nav
      className={`sticky top-0 z-[100000000] w-full ${
        isReelRoute
          ? "bg-transparent border-none shadow-none"
          : isMobile || state === "collapsed"
          ? "bg-background/95 backdrop-blur-xl"
          : "bg-card/95 backdrop-blur-xl"
      }`}
    >
      <div className="mx-auto px-6 xl:px-8 max-w-full xl:container">
        <div className={`flex py-3 items-center ${isReelRoute ? "justify-end" : "justify-between"}`}>
          {!isReelRoute && (
            <div className="flex items-center space-x-8">
              <Link to="/" id="home_button" className="flex items-center space-x-2 group">
                <div className="relative flex items-center ">
                  <div className="">
                    <Logo className="relative h-10 w-10 text-primary" />
                  </div>
                  <span className="text-xl font-bold text-primary">
                    Memories
                  </span>
                </div>
              </Link>
            </div>
          )}

          <div className="flex items-center space-x-3">
             <div onClick={() => setIsModalOpen(true)} className="cursor-pointer rounded-lg h-10 w-10 flex items-center justify-center hover:bg-primary/10 ios-scale">
                  <Plus className="h-5 w-5" />
             </div>
             <Link to="/search" className="cursor-pointer rounded-lg h-10 w-10 flex items-center justify-center hover:bg-primary/10 ios-scale">
              <Search className="h-5 w-5" />
             </Link>
             <SidebarTrigger className="cursor-pointer rounded-lg h-10 w-10 flex items-center justify-center hover:bg-primary/10 ios-scale"/>
          </div>

          
        </div>
      </div>
    </nav>
  );
}