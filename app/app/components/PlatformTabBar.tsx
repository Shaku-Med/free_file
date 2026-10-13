import { Link } from "react-router";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { AccountMenu } from "~/components/UserProfileDropdown";
import { ProfileIcon, type TabIconProps } from "~/components/TabBarIcons";
import { useFileContext } from "~/lib/Context/Context";
import type { TabBarStyle } from "~/lib/hooks/useTabBarStyle";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { cn } from "~/lib/utils";

export type PlatformTab = {
  title: string;
  href: string;
  Icon: (props: TabIconProps) => React.ReactNode;
  active: boolean;
};

type Variant = Exclude<TabBarStyle, "default">;

type Props = {
  variant: Variant;
  /** Home, Subs and Reels, in that order. */
  tabs: PlatformTab[];
  profileActive: boolean;
  searchActive: boolean;
  onSearch: () => void;
  barRef: (el: HTMLElement | null) => void;
};

type Entry =
  | { kind: "link"; tab: PlatformTab }
  | { kind: "search"; active: boolean }
  | { kind: "profile"; active: boolean };

const RESET = "outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring";

const ITEM: Record<Variant, (active: boolean) => string> = {
  "ios-glass": () =>
    "relative z-[1] flex flex-1 flex-col items-center justify-center gap-[3px] rounded-full text-[10px] font-semibold text-foreground transition-transform duration-200 active:scale-[0.94]",
  ios: (active) =>
    cn(
      "flex flex-1 flex-col items-center justify-start gap-[3px] pt-[6px] text-[10px] font-medium",
      active ? "text-foreground" : "text-muted-foreground",
    ),
  material3: (active) =>
    cn(
      "group flex flex-1 flex-col items-center justify-start gap-1 pt-3 text-xs tracking-[0.03em]",
      active ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
    ),
  material2: (active) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 transition-[color,font-size] duration-150",
      active ? "text-[13px] font-medium text-primary" : "text-xs text-muted-foreground",
    ),
};

const ICON: Record<Variant, string> = {
  "ios-glass": "h-[25px] w-[25px]",
  ios: "h-[26px] w-[26px]",
  material3: "h-6 w-6",
  material2: "h-6 w-6",
};

const AVATAR: Record<Variant, string> = {
  "ios-glass": "h-[26px] w-[26px]",
  ios: "h-[27px] w-[27px]",
  material3: "h-6 w-6",
  material2: "h-6 w-6",
};

function ItemBody({
  variant,
  active,
  label,
  icon,
}: {
  variant: Variant;
  active: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  if (variant !== "material3") {
    return (
      <>
        {icon}
        <span className="leading-none">{label}</span>
      </>
    );
  }
  return (
    <>
      <span className="relative flex h-8 w-16 items-center justify-center">
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full bg-secondary transition-[transform,opacity] duration-200 ease-out",
            active ? "scale-100 opacity-100" : "scale-x-[0.4] opacity-0",
          )}
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-foreground/0 transition-colors group-active:bg-foreground/10"
        />
        <span className="relative">{icon}</span>
      </span>
      <span className="leading-4">{label}</span>
    </>
  );
}

function ProfileEntry({ variant, active }: { variant: Variant; active: boolean }) {
  const { userId, userProfile } = useFileContext();
  const className = cn(ITEM[variant](active), RESET);

  if (!userId || !userProfile) {
    return (
      <Link to="/auth/login" aria-label="Sign in" className={className}>
        <ItemBody
          variant={variant}
          active={active}
          label="You"
          icon={<ProfileIcon filled={active} className={ICON[variant]} />}
        />
      </Link>
    );
  }

  const avatar = (
    <Avatar
      className={cn(
        AVATAR[variant],
        active ? "ring-2 ring-current" : "ring-1 ring-border",
      )}
    >
      <AvatarImage src={getProfilePicUrl(userProfile.profile_pic)} alt="" />
      <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
        {userProfile.username.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <AccountMenu>
      <button type="button" aria-label="Account menu" className={className}>
        <ItemBody variant={variant} active={active} label="You" icon={avatar} />
      </button>
    </AccountMenu>
  );
}

function EntryView({ variant, entry, onSearch }: { variant: Variant; entry: Entry; onSearch: () => void }) {
  if (entry.kind === "profile") return <ProfileEntry variant={variant} active={entry.active} />;
  if (entry.kind === "search") {
    return (
      <button
        type="button"
        onClick={onSearch}
        aria-label="Search"
        aria-current={entry.active ? "page" : undefined}
        className={cn(ITEM[variant](entry.active), RESET)}
      >
        <ItemBody
          variant={variant}
          active={entry.active}
          label="Search"
          icon={<Search className={ICON[variant]} strokeWidth={entry.active ? 2.6 : 2} />}
        />
      </button>
    );
  }
  const { tab } = entry;
  return (
    <Link
      to={tab.href}
      aria-current={tab.active ? "page" : undefined}
      className={cn(ITEM[variant](tab.active), RESET)}
    >
      <ItemBody
        variant={variant}
        active={tab.active}
        label={tab.title}
        icon={<tab.Icon filled={tab.active} className={ICON[variant]} />}
      />
    </Link>
  );
}

/** Floating Liquid Glass capsule plus Search in its own circle, as UITabBar draws it on iOS 26. */
function GlassBar({
  entries,
  searchActive,
  onSearch,
  barRef,
}: {
  entries: Entry[];
  searchActive: boolean;
  onSearch: () => void;
  barRef: Props["barRef"];
}) {
  const selected = entries.findIndex((e) => (e.kind === "link" ? e.tab.active : e.active));

  return (
    <nav
      aria-label="Primary"
      data-app-chrome=""
      ref={barRef}
      className="tabbar-font pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-app-chrome)] flex items-end gap-2.5 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(0.75rem,calc(env(safe-area-inset-bottom)-0.75rem))]"
    >
      <ul className="tabbar-glass pointer-events-auto relative flex h-[62px] min-w-0 flex-1 items-stretch rounded-full p-1">
        <span
          aria-hidden
          className={cn(
            "tabbar-glass-selection absolute inset-y-1 left-1 rounded-full transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.3,1.35,0.5,1)]",
            selected < 0 && "opacity-0",
          )}
          style={{
            width: `calc((100% - 0.5rem) / ${entries.length})`,
            transform: `translateX(${Math.max(selected, 0) * 100}%)`,
          }}
        />
        {entries.map((entry, i) => (
          <li key={i} className="flex flex-1">
            <EntryView variant="ios-glass" entry={entry} onSearch={onSearch} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onSearch}
        aria-label="Search"
        aria-current={searchActive ? "page" : undefined}
        className={cn(
          "tabbar-glass pointer-events-auto relative flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-full text-foreground transition-transform duration-200 active:scale-[0.92]",
          RESET,
        )}
      >
        <span
          aria-hidden
          className={cn(
            "tabbar-glass-selection absolute inset-1 rounded-full transition-opacity duration-300",
            !searchActive && "opacity-0",
          )}
        />
        <Search className="relative h-[25px] w-[25px]" strokeWidth={searchActive ? 2.6 : 2.1} />
      </button>
    </nav>
  );
}

const DOCKED: Record<Exclude<Variant, "ios-glass">, { nav: string; row: string }> = {
  ios: { nav: "tabbar-ios", row: "h-[49px]" },
  material3: { nav: "bg-[color-mix(in_oklab,var(--foreground)_5%,var(--background))]", row: "h-20" },
  material2: { nav: "bg-background shadow-[0_-1px_6px_rgb(0_0_0/0.14)]", row: "h-14" },
};

/** Full-width bar on the bottom edge: classic iOS, or Material navigation on Android. */
function DockedBar({
  variant,
  entries,
  onSearch,
  barRef,
}: {
  variant: Exclude<Variant, "ios-glass">;
  entries: Entry[];
  onSearch: () => void;
  barRef: Props["barRef"];
}) {
  return (
    <nav
      aria-label="Primary"
      data-app-chrome=""
      ref={barRef}
      className={cn(
        "tabbar-font fixed inset-x-0 bottom-0 z-[var(--z-app-chrome)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
        DOCKED[variant].nav,
      )}
    >
      <ul className={cn("flex items-stretch", DOCKED[variant].row)}>
        {entries.map((entry, i) => (
          <li key={i} className="flex flex-1">
            <EntryView variant={variant} entry={entry} onSearch={onSearch} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function PlatformTabBar({ variant, tabs, profileActive, searchActive, onSearch, barRef }: Props) {
  const links = tabs.map((tab): Entry => ({ kind: "link", tab }));
  const profile: Entry = { kind: "profile", active: profileActive };

  if (variant === "ios-glass") {
    return (
      <GlassBar entries={[...links, profile]} searchActive={searchActive} onSearch={onSearch} barRef={barRef} />
    );
  }
  return (
    <DockedBar
      variant={variant}
      entries={[...links, profile, { kind: "search", active: searchActive }]}
      onSearch={onSearch}
      barRef={barRef}
    />
  );
}
