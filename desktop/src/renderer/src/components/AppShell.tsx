import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { TopBar } from "@/components/TopBar";

const TITLES: Record<string, string> = {
  "/": "Home",
  "/subscriptions": "Subscriptions",
  "/reels": "Reels",
  "/library": "Library",
  "/playlists": "Playlists",
  "/studio": "Brozy Studio",
};

function titleFromPath(pathname: string): string {
  if (pathname.startsWith("/watch")) return "Watch";
  return TITLES[pathname] ?? "Memories";
}

export function AppShell() {
  const { pathname } = useLocation();
  const isReels = pathname.startsWith("/reels");
  const title = titleFromPath(pathname);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {!isReels ? <Sidebar /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {!isReels ? <TopBar title={title} /> : null}
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
