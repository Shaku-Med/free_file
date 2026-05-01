import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useFileContext } from "~/lib/Context/Context";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Heart, MessageCircle, Reply, ThumbsUp, AtSign, BellRing, UserPlus } from "lucide-react";
import { usePushNotifications } from "~/lib/hooks/usePushNotifications";

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
  /** From joined files table; use for video URL (Dynamic route uses unique_id) */
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
    case "new_subscriber":
      return "subscribed to your channel";
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
    default:
      return null;
  }
}

export default function NotificationsPage() {
  const { userId } = useFileContext();
  const navigate = useNavigate();
  const [list, setList] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const push = usePushNotifications();

  useEffect(() => {
    if (!userId) {
      navigate("/auth/login");
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/notifications?limit=50&offset=0", {
          credentials: "include",
        });
        const data = await res.json();
        if (data.data) setList(data.data);
      } catch {
        setList([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [userId, navigate]);

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

        {push.supported && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                <BellRing className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">Push notifications</p>
                <p className="text-xs text-muted-foreground">
                  {push.isSubscribed
                    ? "You’ll get browser alerts for new activity."
                    : "Get notified when you’re not on the site."}
                </p>
                {push.error && (
                  <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{push.error}</p>
                )}
              </div>
              </div>
              <Button
                variant={push.isSubscribed ? "outline" : "default"}
                size="sm"
                className="w-full shrink-0 sm:w-auto"
                disabled={push.loading || push.permission === "denied"}
                onClick={() => (push.isSubscribed ? push.unsubscribe() : push.subscribe())}
              >
                {push.loading ? "..." : push.isSubscribed ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground text-center py-12">No notifications yet.</p>
        ) : (
          <ul className="space-y-1">
            {list.map((n) => {
              const actor = n.users;
              const username = actor?.username ?? "Someone";
              const href = linkTo(n);
              return (
                <li key={n.id}>
                  <Link
                    to={href}
                    onClick={() => {
                      if (!n.read_at) markOneAsRead(n.id);
                    }}
                    className={`flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50 ${!n.read_at ? "bg-primary/5" : ""}`}
                  >
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarImage src={actor?.profile_pic ? getProfilePicUrl(actor.profile_pic) : undefined} />
                      <AvatarFallback>{username.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{username}</span>{" "}
                        <span className="text-muted-foreground">{getNotificationLabel(n.type)}</span>
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
                    <div className="flex-shrink-0">{getNotificationIcon(n.type)}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
