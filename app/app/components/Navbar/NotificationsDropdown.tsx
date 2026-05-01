import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Bell, Heart, MessageCircle, Reply, ThumbsUp, AtSign, RefreshCw, UserPlus } from "lucide-react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

type NotificationType =
  | "file_like"
  | "file_comment"
  | "comment_reply"
  | "comment_like"
  | "comment_mention"
  | "new_subscriber";

interface NotificationRow {
  id: string;
  type: NotificationType;
  actor_id: string;
  file_id: string | null;
  comment_id: string | null;
  created_at: string;
  read_at: string | null;
  users: { username: string; profile_pic: string | null } | null;
  files: { unique_id: string } | null;
}

function getNotificationLabel(type: NotificationType): string {
  switch (type) {
    case "file_like":
      return "liked your video";
    case "file_comment":
      return "commented on your video";
    case "comment_reply":
      return "replied to your comment";
    case "comment_like":
      return "liked your comment";
    case "comment_mention":
      return "mentioned you in a comment";
    default:
      return "interacted";
  }
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "file_like":
      return <Heart className="h-3.5 w-3.5 text-red-500" />;
    case "file_comment":
      return <MessageCircle className="h-3.5 w-3.5 text-primary" />;
    case "comment_reply":
      return <Reply className="h-3.5 w-3.5 text-primary" />;
    case "comment_like":
      return <ThumbsUp className="h-3.5 w-3.5 text-primary" />;
    case "comment_mention":
      return <AtSign className="h-3.5 w-3.5 text-primary" />;
    case "new_subscriber":
      return <UserPlus className="h-3.5 w-3.5 text-primary" />;
    default:
      return null;
  }
}

const AUTO_REFRESH_MS = 6 * 60 * 1000;

function linkTo(n: NotificationRow): string {
  if (n.type === "new_subscriber") {
    const u = n.users?.username;
    return u ? `/profile/${encodeURIComponent(u)}` : "/";
  }
  const slug = n.files?.unique_id;
  if (!slug) return "/";
  if (n.comment_id) {
    return `/${encodeURIComponent(slug)}?comment=${encodeURIComponent(n.comment_id)}`;
  }
  return `/${encodeURIComponent(slug)}`;
}

interface NotificationsDropdownProps {
  userId: string | null | undefined;
  unreadCount: number;
  setUnreadCount: Dispatch<SetStateAction<number>>;
  iconBtn: string;
}

export function NotificationsDropdown({ userId, unreadCount, setUnreadCount, iconBtn }: NotificationsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<NotificationRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const fetchSeq = useRef(0);

  const syncUnread = useCallback(() => {
    if (!userId) return;
    fetch("/api/notifications?count=1", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success && typeof d.unreadCount === "number") setUnreadCount(d.unreadCount);
      })
      .catch(() => {});
  }, [userId, setUnreadCount]);

  const fetchList = useCallback(
    async (mode: "initial" | "refresh" | "background") => {
      if (!userId) return;
      const seq = ++fetchSeq.current;
      if (mode === "initial") setInitialLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        const res = await fetch("/api/notifications?limit=15&offset=0", { credentials: "include" });
        const d = await res.json().catch(() => null);
        if (seq !== fetchSeq.current) return;
        if (Array.isArray(d?.data)) setList(d.data);
        if (typeof d?.unreadCount === "number") setUnreadCount(d.unreadCount);
      } catch {
        if (seq === fetchSeq.current && mode === "initial") setList([]);
      } finally {
        if (seq === fetchSeq.current) {
          if (mode === "initial") setInitialLoading(false);
          if (mode === "refresh") setRefreshing(false);
        }
      }
    },
    [userId, setUnreadCount]
  );

  useEffect(() => {
    if (!userId) {
      setList([]);
      fetchSeq.current += 1;
      return;
    }
    setList([]);
    void fetchList("initial");
  }, [userId, fetchList]);

  useEffect(() => {
    if (!userId) return;
    const id = window.setInterval(() => {
      void fetchList("background");
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [userId, fetchList]);

  const markOneAsRead = (notificationId: string) => {
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ notificationId }),
    }).catch(() => {});
    setList((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n))
    );
    syncUnread();
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ markAllRead: true }),
      });
      if (!res.ok) return;
      setList((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
      setUnreadCount(0);
      syncUnread();
    } finally {
      setMarkingAll(false);
    }
  };

  const listUnread = list.filter((n) => !n.read_at).length;

  if (!userId) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            type="button"
            className={cn(iconBtn, "relative")}
            aria-label="Notifications"
          >
            <Bell className="h-[1.05rem] w-[1.05rem] sm:h-[1.15rem] sm:w-[1.15rem]" strokeWidth={2.25} />
            {unreadCount > 0 ? (
              <span className="absolute right-0.5 top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background dark:ring-card">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Notifications</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-[min(100vw-1.5rem,22rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={refreshing || initialLoading}
                    aria-label="Refresh notifications"
                    onClick={(e) => {
                      e.preventDefault();
                      void fetchList("refresh");
                    }}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>
            {listUnread > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={markingAll}
                onClick={(e) => {
                  e.preventDefault();
                  void markAllRead();
                }}
              >
                {markingAll ? "…" : "Mark all read"}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
          {initialLoading && list.length === 0 ? (
            <div className="space-y-2 px-2 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-muted/60 animate-pulse" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            list.map((n) => {
              const actor = n.users;
              const username = actor?.username ?? "Someone";
              const href = linkTo(n);
              return (
                <DropdownMenuItem key={n.id} asChild className="cursor-pointer p-0 focus:bg-transparent">
                  <Link
                    to={href}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent",
                      !n.read_at && "bg-primary/5"
                    )}
                    onClick={() => {
                      if (!n.read_at) markOneAsRead(n.id);
                    }}
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={actor?.profile_pic ? getProfilePicUrl(actor.profile_pic) : undefined} />
                      <AvatarFallback className="text-xs">{username.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-snug text-foreground">
                        <span className="font-medium">{username}</span>{" "}
                        <span className="text-muted-foreground">{getNotificationLabel(n.type)}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(n.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="shrink-0">{getNotificationIcon(n.type)}</div>
                  </Link>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <DropdownMenuItem asChild className="p-0 focus:bg-transparent">
          <Link
            to="/notifications"
            className="flex w-full cursor-pointer items-center justify-center rounded-lg px-2 py-2.5 text-sm font-medium text-primary hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            View all
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
