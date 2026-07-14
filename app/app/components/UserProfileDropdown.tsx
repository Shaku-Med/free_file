import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { usePushNotifications } from "~/lib/hooks/usePushNotifications";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { formatSubscriberCount } from "~/components/SubscribeButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useFileContext } from "~/lib/Context/Context";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { cn } from "~/lib/utils";
import { LogIn, User, Settings, LogOut, Heart, UserPlus, FileEdit, Download } from "lucide-react";
import { detectWindapp } from "~/lib/hooks/useWindapp";

type Variant = "topbar" | "bottombar" | "sidebar";

interface UserProfileDropdownProps {
  variant: Variant;
}

type AccountStats = {
  subscribers: number;
  uploads: number;
  views: number;
  likes: number;
  comments: number;
  views28d: number;
  watchHours28d: number;
};

const num = (v: unknown) => Math.max(0, Number(v) || 0);

/**
 * Session-scoped cache for the account stats so we only hit the network once,
 * not every time the sidebar/sheet (re)mounts. Keyed by user id so switching
 * accounts refetches; an in-flight promise is shared so concurrent mounts
 * (e.g. desktop sidebar + mobile sheet) don't fire duplicate requests.
 */
let cachedStatsUserId: string | null = null;
let cachedStats: AccountStats | null = null;
let inflightStats: Promise<AccountStats | null> | null = null;

function loadAccountStats(userId: string): Promise<AccountStats | null> {
  if (cachedStats && cachedStatsUserId === userId) return Promise.resolve(cachedStats);
  if (inflightStats && cachedStatsUserId === userId) return inflightStats;

  cachedStatsUserId = userId;
  cachedStats = null;
  inflightStats = fetch("/api/studio/overview", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (
        d: {
          success?: boolean;
          totals?: {
            posts?: unknown;
            views?: unknown;
            likes?: unknown;
            comments?: unknown;
            subscribers?: unknown;
          };
          last28d?: { views?: unknown; watchHours?: unknown };
        } | null,
      ) => {
        if (!d?.success || !d.totals) return null;
        const stats: AccountStats = {
          subscribers: num(d.totals.subscribers),
          uploads: num(d.totals.posts),
          views: num(d.totals.views),
          likes: num(d.totals.likes),
          comments: num(d.totals.comments),
          views28d: num(d.last28d?.views),
          watchHours28d: num(d.last28d?.watchHours),
        };
        // Only cache once the id still matches (guard against an account switch
        // that started a newer request mid-flight).
        if (cachedStatsUserId === userId) cachedStats = stats;
        return stats;
      },
    )
    .catch(() => null)
    // Clear the in-flight handle so a failed attempt can be retried later,
    // while a successful one keeps serving from `cachedStats`.
    .finally(() => {
      inflightStats = null;
    });

  return inflightStats;
}

/**
 * Reads the signed-in user's own subscriber + upload counts.
 *
 * Security: the figures come from `/api/studio/overview`, which authenticates the
 * request via the session cookie and derives the user id server-side
 * (`isAuthenticated` → `user.id`). No user id is ever sent from the client, so a
 * caller cannot read another account's stats by tampering with a request param.
 * Only used by the `sidebar` variant to avoid extra requests elsewhere.
 */
function useAccountStats(enabled: boolean, userId: string | null | undefined) {
  const [stats, setStats] = useState<AccountStats | null>(() =>
    userId && cachedStatsUserId === userId ? cachedStats : null,
  );

  useEffect(() => {
    if (!enabled || !userId) {
      setStats(null);
      return;
    }
    // Serve instantly from the session cache when we already have it.
    if (cachedStats && cachedStatsUserId === userId) {
      setStats(cachedStats);
      return;
    }
    let cancelled = false;
    loadAccountStats(userId).then((s) => {
      if (!cancelled && s) setStats(s);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  return stats;
}

/** Compact channel stats grid shown at the top of the account menu. */
function ChannelStatsBlock({ stats }: { stats: AccountStats }) {
  const items: { label: string; value: string }[] = [
    { label: "Views", value: formatSubscriberCount(stats.views) },
    { label: "Subscribers", value: formatSubscriberCount(stats.subscribers) },
    { label: "Uploads", value: formatSubscriberCount(stats.uploads) },
    { label: "Likes", value: formatSubscriberCount(stats.likes) },
    { label: "Comments", value: formatSubscriberCount(stats.comments) },
    { label: "Watch 28d", value: `${stats.watchHours28d}h` },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 px-1.5 py-1.5">
      {items.map((it) => (
        <div
          key={it.label}
          className="flex flex-col items-center justify-center rounded-md bg-muted/50 px-1 py-1.5"
        >
          <span className="text-sm font-semibold tabular-nums leading-none text-foreground">
            {it.value}
          </span>
          <span className="mt-1 text-[10px] leading-none text-muted-foreground">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Stats header for the account menu. Lives as a child of `DropdownMenuContent`
 * so it only mounts (and fetches) when the menu is actually opened. Rendered by
 * the shared `ProfileMenuContent`, so navbar, mobile tab bar and sidebar all get
 * the identical block from one place.
 */
function MenuStatsSection() {
  const { userId } = useFileContext();
  const stats = useAccountStats(Boolean(userId), userId);
  if (!stats) return null;
  return (
    <>
      <ChannelStatsBlock stats={stats} />
      <DropdownMenuSeparator />
    </>
  );
}

function ProfileMenuContent({ username }: { username: string | undefined }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { altAccounts } = useFileContext();
  const { unsubscribe: unsubscribePush } = usePushNotifications();
  const [switching, setSwitching] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const logoutTo = `/logout?redirect=${encodeURIComponent(returnTo)}`;
  const addAccountHref = `/auth/login?addAccount=1&redirect=${encodeURIComponent(returnTo)}`;

  /**
   * Sign out. First cancel THIS device's push subscription (while we're still
   * authenticated  the DELETE endpoint needs the session), so it stops getting
   * notifications after logout. Best-effort + time-boxed so a slow or unsupported
   * push stack never blocks sign-out, then hand off to the server logout route.
   */
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await Promise.race([
        unsubscribePush(),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch {
      /* ignore  log out regardless */
    }
    navigate(logoutTo);
  };

  const switchAccount = async (uid: string) => {
    setSwitching(uid);
    try {
      const res = await fetch("/api/auth/switch-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId: uid }),
      });
      if (res.ok) {
        window.location.assign(returnTo);
      }
    } finally {
      setSwitching(null);
    }
  };

  return (
    <>
    <DropdownMenuContent align="end" className="w-60">
      <MenuStatsSection />
      <DropdownMenuItem asChild>
        <Link to={username ? `/profile/${username}` : "/"} className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <span>Profile</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/brozystudio" className="flex items-center gap-2">
          <FileEdit className="h-4 w-4" />
          <span>Studio</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/playlist" className="flex items-center gap-2">
          <Heart className="h-4 w-4" />
          <span>Playlist</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/settings" className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Link>
      </DropdownMenuItem>
      {!detectWindapp() && (
        <DropdownMenuItem asChild>
          <Link to="/download" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            <span>Download app</span>
          </Link>
        </DropdownMenuItem>
      )}
      {altAccounts.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground px-2 py-1.5">
            Other accounts
          </DropdownMenuLabel>
          {altAccounts.map((a) => (
            <DropdownMenuItem
              key={a.id}
              className="cursor-pointer flex items-center gap-2.5"
              disabled={switching !== null}
              onSelect={(e) => {
                e.preventDefault();
                void switchAccount(a.id);
              }}
            >
              <Avatar className="h-7 w-7 shrink-0 ring-1 ring-border">
                <AvatarImage src={getProfilePicUrl(a.profile_pic ?? undefined)} alt="" />
                <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-medium">
                  {a.username.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate min-w-0">
                {switching === a.id ? "Switching…" : a.username}
              </span>
            </DropdownMenuItem>
          ))}
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link to={addAccountHref} className="flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          <span>Add account</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="flex items-center gap-2 text-destructive focus:text-destructive"
        onSelect={() => setConfirmLogout(true)}
      >
        <LogOut className="h-4 w-4" />
        <span>Log out</span>
      </DropdownMenuItem>
    </DropdownMenuContent>

      <Dialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>
              You'll need to sign in again to access your account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLogout(false)} disabled={signingOut}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserProfileDropdown({ variant }: UserProfileDropdownProps) {
  const { userId, userProfile, userProfileLoading } = useFileContext();
  const location = useLocation();
  const accountStats = useAccountStats(variant === "sidebar" && Boolean(userId), userId);

  // Sidebar footer: full-width account row (avatar + name + subs/uploads) that
  // collapses to just the avatar in the icon rail. Reuses the same dropdown menu.
  if (variant === "sidebar") {
    if (!userId) {
      return (
        <div className="flex w-full flex-col gap-0.5">
          <Button
            asChild
            variant="ghost"
            className="h-auto w-full justify-start gap-2.5 px-2 py-2 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <Link to="/auth/login" aria-label="Sign in">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border">
                <LogIn className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">Sign In</span>
            </Link>
          </Button>
          {!detectWindapp() && (
            <Button
              asChild
              variant="ghost"
              className="h-auto w-full justify-start gap-2.5 px-2 py-2 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <Link to="/download" aria-label="Download app">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border">
                  <Download className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">
                  Download app
                </span>
              </Link>
            </Button>
          )}
        </div>
      );
    }

    const statsLabel =
      accountStats &&
      `${formatSubscriberCount(accountStats.subscribers)} ${
        accountStats.subscribers === 1 ? "subscriber" : "subscribers"
      } · ${formatSubscriberCount(accountStats.uploads)} ${
        accountStats.uploads === 1 ? "upload" : "uploads"
      }`;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1"
          >
            {userProfileLoading ? (
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
            ) : (
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={getProfilePicUrl(userProfile?.profile_pic)} alt={userProfile?.username} />
                <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                  {userProfile?.username?.charAt(0).toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
            )}
            <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <span className="block truncate text-sm font-medium text-foreground">
                {userProfile?.username ?? "Account"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {statsLabel ?? "View your channel"}
              </span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <ProfileMenuContent username={userProfile?.username} />
      </DropdownMenu>
    );
  }

  // Mobile tab-bar profile: same dropdown menu, styled as a bottom-bar tab.
  if (variant === "bottombar") {
    const active = location.pathname.startsWith("/profile/");
    const tabClass = cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
      active ? "text-primary" : "text-muted-foreground",
    );

    if (!userId || !userProfile) {
      return (
        <Link to="/auth/login" aria-label="Sign in" className={tabClass}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-border">
            <User className="h-3.5 w-3.5" />
          </span>
          <span className="leading-none">Profile</span>
        </Link>
      );
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Account menu" className={tabClass}>
            <Avatar className={cn("h-6 w-6 ring-1", active ? "ring-primary" : "ring-border")}>
              <AvatarImage src={getProfilePicUrl(userProfile.profile_pic)} alt="" />
              <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                {userProfile.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="leading-none">Profile</span>
          </button>
        </DropdownMenuTrigger>
        <ProfileMenuContent username={userProfile.username} />
      </DropdownMenu>
    );
  }

  // topbar  show Sign In button when not logged in
  if (!userId) {
    return (
      <div className="flex items-center gap-1">
        {!detectWindapp() && (
          <Button asChild size="sm" variant="ghost" className="h-8 gap-1.5 text-xs sm:text-sm">
            <Link to="/download" aria-label="Download app">
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </Link>
          </Button>
        )}
        <Button asChild size="sm" className="h-8 gap-1.5 text-xs sm:text-sm">
          <Link to="/auth/login">
            <LogIn className="h-3.5 w-3.5" />
            <span>Sign In</span>
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-0 transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="User menu"
        >
          {userProfileLoading ? (
            <div className="size-8 shrink-0 rounded-full bg-muted animate-pulse" />
          ) : (
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={getProfilePicUrl(userProfile?.profile_pic)} alt={userProfile?.username} />
              <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                {userProfile?.username?.charAt(0).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          )}
        </button>
      </DropdownMenuTrigger>
      <ProfileMenuContent username={userProfile?.username} />
    </DropdownMenu>
  );
}
