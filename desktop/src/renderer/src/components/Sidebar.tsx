import {
  Clapperboard,
  Film,
  Home,
  LayoutDashboard,
  LibraryBig,
  ListVideo,
  Users,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { NAV_ITEMS, type NavId } from "@/data/mock";

const ICONS: Record<NavId, typeof Home> = {
  home: Home,
  subscriptions: Users,
  reels: Clapperboard,
  library: LibraryBig,
  playlists: ListVideo,
  studio: LayoutDashboard,
  watch: Film,
};

const ROUTES: Partial<Record<NavId, string>> = {
  home: "/",
  subscriptions: "/subscriptions",
  reels: "/reels",
  library: "/library",
  playlists: "/playlists",
  studio: "/studio",
};

export function Sidebar() {
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-sidebar">
      <nav className="flex flex-1 flex-col gap-1 p-3 pt-4">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.id];
          const to = ROUTES[item.id] ?? "/";
          return (
            <NavLink
              key={item.id}
              to={to}
              className={({ isActive }) =>
                [
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive
                    ? "bg-sidebar-active text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
                    : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={[
                      "size-4 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    ].join(" ")}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {item.hint}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="font-display text-xs font-semibold text-foreground">UI preview</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Layout only — no API or database wired yet.
          </p>
        </div>
      </div>
    </aside>
  );
}
