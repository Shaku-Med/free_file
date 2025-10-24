import { useState } from "react";
import { Link } from "react-router";
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
  ChevronRight
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <nav className="sticky top-0 z-50 w-full ios-glass border-0 ios-shadow">
      <div className="mx-auto px-6 xl:px-8 max-w-full xl:container">
        <div className="flex py-4 items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link to="/" className="flex items-center space-x-4 group ios-scale">
              <div className="relative flex items-center space-x-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center ios-scale">
                  <Logo className="relative h-8 w-8 text-primary" />
                </div>
                <span className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">Memories</span>
              </div>
            </Link>
            
            <NavigationMenu className="hidden xl:flex">
              <NavigationMenuList className="space-x-1">
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="text-sm font-semibold rounded-2xl px-4 py-2 ios-scale">Gallery</NavigationMenuTrigger>
                  <NavigationMenuContent className="ios-glass rounded-3xl ios-shadow-lg border-0">
                    <div className="grid w-[500px] gap-3 p-6 lg:w-[600px] lg:grid-cols-2">
                      {galleryCategories.map((category) => (
                        <NavigationMenuLink key={category.name} asChild>
                          <Link
                            to={category.href}
                            className="group block select-none space-y-1 rounded-2xl p-4 leading-none no-underline outline-none transition-all hover:bg-primary/10 ios-scale"
                          >
                            <div className="text-sm font-semibold leading-none group-hover:text-primary transition-colors">
                              {category.name}
                            </div>
                          </Link>
                        </NavigationMenuLink>
                      ))}
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                
                <NavigationMenuItem>
                  <Link to="/about">
                    <NavigationMenuLink className="group inline-flex h-10 w-max items-center justify-center rounded-2xl bg-transparent px-4 py-2 text-sm font-semibold transition-all hover:bg-primary/10 ios-scale focus:bg-primary/10 focus:text-primary focus:outline-none disabled:pointer-events-none disabled:opacity-50">
                      About
                    </NavigationMenuLink>
                  </Link>
                </NavigationMenuItem>
                
                <NavigationMenuItem>
                  <Link to="/contact">
                    <NavigationMenuLink className="group inline-flex h-10 w-max items-center justify-center rounded-2xl bg-transparent px-4 py-2 text-sm font-semibold transition-all hover:bg-primary/10 ios-scale focus:bg-primary/10 focus:text-primary focus:outline-none disabled:pointer-events-none disabled:opacity-50">
                      Contact
                    </NavigationMenuLink>
                  </Link>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          <div className="flex items-center space-x-3 lg:space-x-3">
            <div className="hidden lg:flex items-center space-x-3">
              <div className="relative group">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-hover:text-primary transition-colors" />
                <Input
                  type="search"
                  placeholder="Search photos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-72 pl-11 h-11 rounded-2xl border-0 bg-primary/5 focus:bg-primary/10 focus:ring-2 focus:ring-primary/20 transition-all ios-scale"
                />
              </div>
              
              <Button variant="ghost" size="icon" className="h-11 w-11 rounded-2xl hover:bg-primary/10 ios-scale">
                <Filter className="h-4 w-4" />
              </Button>
              
              <div className="flex items-center bg-primary/5 rounded-2xl p-1">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-primary/10 ios-scale">
                  <Grid3X3 className="h-4 w-4" />
                </Button>
                
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-primary/10 ios-scale">
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center space-x-2 lg:space-x-3">
              <Button variant="ghost" size="icon" className="relative h-11 w-11 rounded-2xl hover:bg-primary/10 ios-scale hidden sm:flex">
                <Heart className="h-5 w-5" />
                <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center ios-shadow">
                  3
                </Badge>
              </Button>
              
              <Button variant="ghost" size="icon" className="relative h-11 w-11 rounded-2xl hover:bg-primary/10 ios-scale hidden sm:flex">
                <ShoppingCart className="h-5 w-5" />
                <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center ios-shadow">
                  2
                </Badge>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-11 w-11 rounded-2xl hover:bg-primary/10 ios-scale hidden sm:flex">
                    <User className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-2xl ios-glass border-0 ios-shadow-lg">
                  <DropdownMenuLabel className="font-semibold px-4 py-3">My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-border/20" />
                  {userMenuItems.map((item) => (
                    <DropdownMenuItem key={item.name} asChild className="cursor-pointer rounded-xl mx-2 my-1 ios-scale">
                      <Link to={item.href} className="flex items-center px-3 py-2">
                        <item.icon className="mr-3 h-4 w-4" />
                        {item.name}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator className="bg-border/20" />
                  <DropdownMenuItem className="cursor-pointer rounded-xl text-destructive focus:text-destructive mx-2 my-1 ios-scale">
                    <LogOut className="mr-3 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="xl:hidden h-11 w-11 rounded-2xl hover:bg-primary/10 ios-scale">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:w-96 p-0 border-l-0 ios-glass">
                <div className="flex flex-col h-full bg-background/95 backdrop-blur-xl">
                  <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/20">
                    <div className="flex items-center justify-between">
                      <SheetTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">Memories</SheetTitle>
                    </div>
                  </SheetHeader>
                  
                  <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8">
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="search"
                          placeholder="Search photos..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-11 h-12 rounded-2xl bg-primary/5 border-0 focus-visible:ring-2 focus-visible:ring-primary/20 ios-scale"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="px-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Gallery</h3>
                      </div>
                      <div className="bg-card/50 rounded-2xl overflow-hidden border border-border/20 ios-shadow">
                        {galleryCategories.map((category, index) => (
                          <Link
                            key={category.name}
                            to={category.href}
                            className={`flex items-center justify-between px-4 py-3.5 text-sm font-medium active:bg-primary/10 transition-colors ios-scale ${
                              index !== galleryCategories.length - 1 ? 'border-b border-border/20' : ''
                            }`}
                          >
                            <span>{category.name}</span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </Link>
                        ))}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="px-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">View Options</h3>
                      </div>
                      <div className="bg-card/50 rounded-2xl overflow-hidden border border-border/20 ios-shadow">
                        <button className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-medium border-b border-border/20 active:bg-primary/10 transition-colors ios-scale">
                          <div className="flex items-center">
                            <Grid3X3 className="mr-3 h-4 w-4 text-muted-foreground" />
                            <span>Grid View</span>
                          </div>
                          <div className="h-5 w-5 rounded-full border-2 border-primary bg-primary flex items-center justify-center ios-shadow">
                            <div className="h-2 w-2 rounded-full bg-background" />
                          </div>
                        </button>
                        <button className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-medium active:bg-primary/10 transition-colors ios-scale">
                          <div className="flex items-center">
                            <List className="mr-3 h-4 w-4 text-muted-foreground" />
                            <span>List View</span>
                          </div>
                          <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="px-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Account</h3>
                      </div>
                      <div className="bg-card/50 rounded-2xl overflow-hidden border border-border/20 ios-shadow">
                        {userMenuItems.map((item, index) => (
                          <Link
                            key={item.name}
                            to={item.href}
                            className={`flex items-center px-4 py-3.5 text-sm font-medium active:bg-primary/10 transition-colors ios-scale ${
                              index !== userMenuItems.length - 1 ? 'border-b border-border/20' : ''
                            }`}
                          >
                            <item.icon className="mr-3 h-5 w-5 text-muted-foreground" />
                            <span>{item.name}</span>
                          </Link>
                        ))}
                      </div>
                      
                      <div className="bg-card/50 rounded-2xl overflow-hidden border border-border/20 ios-shadow mt-3">
                        <button className="w-full flex items-center px-4 py-3.5 text-sm font-medium text-destructive active:bg-destructive/10 transition-colors ios-scale">
                          <LogOut className="mr-3 h-5 w-5" />
                          <span>Logout</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}