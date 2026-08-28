import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useFileContext } from "~/lib/Context/Context";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Heart, MessageCircle, Reply, ThumbsUp, AtSign, UserPlus, ChevronDown, CircleCheck, TriangleAlert } from "lucide-react";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { groupNotifications, type NotificationGroup } from "~/lib/notifications/groupNotifications";

type NotificationType =
  | "file_like"
  | "file_comment"
  | "comment_reply"
  | "comment_like"
  | "comment_mention"
  | "new_subscriber"
  | "upload_ready"
  | "upload_failed";

interface NotificationRow {
  id: string;
  type: NotificationType;
  actor_id: string;
  file_id: string | null;
  comment_id: string | null;
  created_at: string;
  read_at: string | null;
  users: { username: string; profile_pic: string | null } | null;
  /** From joined files table  enough fields to resolve a poster URL via
   *  `getThumbnailUrl()` AND to navigate to the watch page. */
  files: {
    unique_id: string;
    default_thumbnail: string | null;
    file_type: string | null;
    endpoint: string | null;
    created_at: string;
    filename: string;
    is_adult: boolean | null;
  } | null;
}

/**
 * Upload outcomes come from the system, not another member. actor_id holds the
 * recipient only because the column is NOT NULL, so naming the actor would
 * render "medzyamara your upload is ready".
 */
function isSystemNotification(type: NotificationType): boolean {
  return type === "upload_ready" || type === "upload_failed";
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
    case "new_subscriber":
      return "subscribed to your channel";
    case "upload_ready":
      return "Your upload finished processing";
    case "upload_failed":
      return "Your upload could not be processed";
    default:
      return "interacted";
  }
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "file_like":
      return <Heart className="h-4 w-4 text-red-500" />;
    case "file_comment":
      return <MessageCircle className="h-4 w-4 text-primary" />;
    case "comment_reply":
      return <Reply className="h-4 w-4 text-primary" />;
    case "comment_like":
      return <ThumbsUp className="h-4 w-4 text-primary" />;
    case "comment_mention":
      return <AtSign className="h-4 w-4 text-primary" />;
    case "new_subscriber":
      return <UserPlus className="h-4 w-4 text-primary" />;
    case "upload_ready":
      return <CircleCheck className="h-4 w-4 text-primary" />;
    case "upload_failed":
      return <TriangleAlert className="h-4 w-4 text-destructive" />;
    default:
      return null;
  }
}

export default function NotificationsPage() {
  const { userId } = useFileContext();
  const navigate = useNavigate();
  const [list, setList] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/notifications?limit=50&offset=0", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setList(Array.isArray(data?.data) ? data.data : []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      navigate("/auth/login");
      return;
    }
    load();
  }, [userId, navigate, load]);

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ markAllRead: true }),
      });
      setList((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
    } finally {
      setMarkingAll(false);
    }
  };

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
  };

  const linkTo = (n: NotificationRow) => {
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
  };

  const unreadCount = list.filter((n) => !n.read_at).length;
  const sections = useMemo(() => groupNotifications(list), [list]);

  const markGroupRead = (g: NotificationGroup<NotificationRow>) => {
    const unread = g.items.filter((i) => !i.read_at);
    if (!unread.length) return;
    const ids = new Set(unread.map((i) => i.id));
    setList((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, read_at: new Date().toISOString() } : n)));
    unread.forEach((i) => {
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notificationId: i.id }),
      }).catch(() => {});
    });
  };

  const toggleGroup = (g: NotificationGroup<NotificationRow>) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g.key)) {
        next.delete(g.key);
      } else {
        next.add(g.key);
        markGroupRead(g);
      }
      return next;
    });
  };

  const groupHeadline = (g: NotificationGroup<NotificationRow>) => {
    const first = g.actors[0]?.username ?? "Someone";
    const others = Math.max(0, g.actors.length - 1);
    return others > 0 ? `${first} and ${others} other${others === 1 ? "" : "s"}` : first;
  };

  /** One notification as a clickable row (used for singles + expanded items). */
  const renderSingle = (n: NotificationRow, nested = false) => {
    const actor = n.users;
    const username = actor?.username ?? "Someone";
    const href = linkTo(n);
    const fileForThumb: FileType | null = n.files
      ? ({
          id: n.file_id ?? n.files.unique_id,
          unique_id: n.files.unique_id,
          filename: n.files.filename,
          default_thumbnail: n.files.default_thumbnail,
          file_type: n.files.file_type ?? undefined,
          endpoint: n.files.endpoint ?? undefined,
          created_at: n.files.created_at,
          is_adult: Boolean(n.files.is_adult),
        } as FileType)
      : null;
    return (
      <Link
        to={href}
        onClick={() => {
          if (!n.read_at) markOneAsRead(n.id);
        }}
        className={`flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50 ${nested ? "pl-12" : ""} ${!n.read_at ? "bg-primary/5" : ""}`}
      >
        <Avatar className="h-10 w-10 flex-shrink-0">
          <AvatarImage src={actor?.profile_pic ? getProfilePicUrl(actor.profile_pic) : undefined} />
          <AvatarFallback>{username.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">
            {isSystemNotification(n.type) ? (
              <span className="text-foreground">{getNotificationLabel(n.type)}</span>
            ) : (
              <>
                <span className="font-medium">{username}</span>{" "}
                <span className="text-muted-foreground">{getNotificationLabel(n.type)}</span>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(n.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        {fileForThumb ? (
          <div className="relative h-12 w-[4.25rem] flex-shrink-0">
            <VideoCard data={fileForThumb} layout="notificationThumb" />
            {getNotificationIcon(n.type) && (
              <div className="pointer-events-none absolute bottom-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-border">
                {getNotificationIcon(n.type)}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-shrink-0">{getNotificationIcon(n.type)}</div>
        )}
      </Link>
    );
  };

  if (!userId) return null;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Notifications</h1>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} disabled={markingAll}>
              Mark all read
            </Button>
          )}
        </div>

        {/* Push notifications enable/disable now lives in Settings  this
            page focuses on the in-app notifications feed. */}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">Couldn't load notifications.</p>
            <Button variant="outline" size="sm" onClick={() => load()}>
              Try again
            </Button>
          </div>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground text-center py-12">No notifications yet.</p>
        ) : (
          <div className="space-y-5">
            {sections.map((section) => (
              <div key={section.label}>
                <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </h2>
                <ul className="space-y-1">
                  {section.groups.map((g) => {
                    if (g.count === 1) return <li key={g.key}>{renderSingle(g.latest)}</li>;
                    const isOpen = expanded.has(g.key);
                    const first = g.actors[0];
                    return (
                      <li key={g.key}>
                        <button
                          type="button"
                          onClick={() => toggleGroup(g)}
                          className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-muted/50 ${g.unread ? "bg-primary/5" : ""}`}
                          aria-expanded={isOpen}
                        >
                          <Avatar className="h-10 w-10 flex-shrink-0">
                            <AvatarImage src={first?.profile_pic ? getProfilePicUrl(first.profile_pic) : undefined} />
                            <AvatarFallback>{(first?.username ?? "?").charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-foreground">
                              <span className="font-medium">{groupHeadline(g)}</span>{" "}
                              <span className="text-muted-foreground">{getNotificationLabel(g.type as NotificationType)}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {g.count} notifications ·{" "}
                              {new Date(g.latest.created_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        {isOpen && (
                          <ul className="ml-5 mt-0.5 space-y-0.5 border-l border-border/60">
                            {g.items.map((n) => (
                              <li key={n.id}>{renderSingle(n, true)}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
