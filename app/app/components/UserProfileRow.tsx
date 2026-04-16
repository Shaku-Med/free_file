import { useState, useEffect } from "react";
import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { cn } from "~/lib/utils";
import SubscribeButton, { formatSubscriberCount } from "~/components/SubscribeButton";

export interface UserProfileRowProps {
  userId: string;
  username: string;
  profilePic: string;
  subscriberCount: number;
  isSubscribed: boolean;
  notify: boolean;
  currentUserId: string | null | undefined;
  compact?: boolean;
  /** e.g. close a parent dialog after navigating to profile */
  onNavigate?: () => void;
  className?: string;
}

/**
 * Avatar + username + subscriber count + Subscribe button — reuse anywhere you show another user’s channel.
 */
export function UserProfileRow({
  userId,
  username,
  profilePic,
  subscriberCount,
  isSubscribed,
  notify,
  currentUserId,
  compact = true,
  onNavigate,
  className,
}: UserProfileRowProps) {
  const [displaySubs, setDisplaySubs] = useState(subscriberCount);

  useEffect(() => {
    setDisplaySubs(subscriberCount);
  }, [subscriberCount]);

  const owner = Boolean(currentUserId && currentUserId === userId);

  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-center gap-2 sm:gap-3",
        className
      )}
    >
      <Link
        to={`/profile/${username}`}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 pr-1 transition-colors hover:bg-muted/60"
      >
        <Avatar className={cn("h-10 w-10 shrink-0 sm:h-11 sm:w-11")}>
          <AvatarImage src={getProfilePicUrl(profilePic)} alt="" />
          <AvatarFallback className="text-sm font-medium">
            {username.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate font-semibold leading-tight text-foreground">{username}</p>
          <p className="text-xs text-muted-foreground">
            {formatSubscriberCount(displaySubs)} subscribers
          </p>
        </div>
      </Link>
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <SubscribeButton
          channelId={userId}
          currentUserId={currentUserId ?? null}
          initialSubscribed={isSubscribed}
          initialNotify={notify}
          initialCount={displaySubs}
          isOwner={owner}
          compact={compact}
          onSubscriberCountChange={setDisplaySubs}
        />
      </div>
    </div>
  );
}
