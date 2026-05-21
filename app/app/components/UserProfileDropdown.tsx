import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useFileContext } from "~/lib/Context/Context";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { LogIn, User, Settings, LogOut, ChevronDown, Heart, UserPlus } from "lucide-react";

type Variant = "sidebar" | "topbar";

interface UserProfileDropdownProps {
  variant: Variant;
}

function ProfileMenuContent({ username }: { username: string | undefined }) {
  const location = useLocation();
  const { altAccounts } = useFileContext();
  const [switching, setSwitching] = useState<string | null>(null);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const logoutTo = `/logout?redirect=${encodeURIComponent(returnTo)}`;
  const addAccountHref = `/auth/login?addAccount=1&redirect=${encodeURIComponent(returnTo)}`;

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
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuItem asChild>
        <Link to={username ? `/profile/${username}` : "/"} className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <span>Profile</span>
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
      <DropdownMenuItem asChild>
        <Link to={logoutTo} className="flex items-center gap-2 text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" />
          <span>Log out</span>
        </Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function UserProfileDropdown({ variant }: UserProfileDropdownProps) {
  const { userId, userProfile, userProfileLoading } = useFileContext();

  if (variant === "sidebar") {
    if (userProfileLoading && userId) {
      return (
        <div className="flex items-center gap-2.5 p-2">
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-20 bg-muted animate-pulse rounded" />
            <div className="h-2.5 w-14 bg-muted animate-pulse rounded" />
          </div>
        </div>
      );
    }
    if (!userId || !userProfile) {
      return (
        <Button asChild className="w-full h-9 text-sm" variant="outline">
          <Link to="/auth/login">
            <LogIn className="mr-2 h-4 w-4" />
            Sign In
          </Link>
        </Button>
      );
    }
    const bioPreview = userProfile.about
      ? userProfile.about.length > 50
        ? userProfile.about.substring(0, 50) + "..."
        : userProfile.about
      : null;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/80 transition-colors group text-left">
            <Avatar className="h-8 w-8 flex-shrink-0 ring-1 ring-border">
              <AvatarImage src={getProfilePicUrl(userProfile.profile_pic)} alt={userProfile.username} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
                {userProfile.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-foreground truncate group-hover:text-primary transition-colors leading-tight">
                {userProfile.username}
              </p>
              {bioPreview && (
                <p className="text-[11px] text-muted-foreground truncate leading-tight">{bioPreview}</p>
              )}
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0 group-hover:text-muted-foreground transition-colors" />
          </button>
        </DropdownMenuTrigger>
        <ProfileMenuContent username={userProfile.username} />
      </DropdownMenu>
    );
  }

  // topbar — show Sign In button when not logged in
  if (!userId) {
    return (
      <Button asChild size="sm" className="h-8 gap-1.5 text-xs sm:text-sm">
        <Link to="/auth/login">
          <LogIn className="h-3.5 w-3.5" />
          <span>Sign In</span>
        </Link>
      </Button>
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
