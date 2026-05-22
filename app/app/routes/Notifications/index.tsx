import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useFileContext } from "~/lib/Context/Context";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Heart, MessageCircle, Reply, ThumbsUp, AtSign, UserPlus } from "lucide-react";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";

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
  /** From joined files table — enough fields to resolve a poster URL via
   *  `getThumbnailUrl()` AND to navigate to the watch page. */
  files: {
    unique_id: string;
    default_thumbnail: string | null;
    thumbnails: string[] | null;
    file_type: string | null;
    endpoint: string | null;
    created_at: string;
    filename: string;
    is_adult: boolean | null;
  } | null;
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

        {/* Push notifications enable/disable now lives in Settings — this
            page focuses on the in-app notifications feed. */}

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
              // Resolve the file's thumbnail URL only when this row is
              // about a file (likes, comments, replies, mentions).
              // Subscribe events have no file → no thumbnail, the row
              // keeps its existing avatar-only shape.
              // Shape the joined `files` row into the minimum that
              // VideoCard / renderThumbnail need. Everything thumbnail-
              // related (default vs frames[] vs legacy path, NSFW blur,
              // retry-on-error, lazy loading) is already handled inside
              // VideoCard — we don't re-implement it here.
              const fileForThumb: FileType | null = n.files
                ? ({
                    id: n.file_id ?? n.files.unique_id,
                    unique_id: n.files.unique_id,
                    filename: n.files.filename,
                    default_thumbnail: n.files.default_thumbnail,
                    thumbnails: n.files.thumbnails ?? undefined,
                    file_type: n.files.file_type ?? undefined,
                    endpoint: n.files.endpoint ?? undefined,
                    created_at: n.files.created_at,
                    is_adult: Boolean(n.files.is_adult),
                  } as FileType)
                : null;
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
                    {/* File preview — instagram-style right-side thumb.
                        Reuses VideoCard's `notificationThumb` layout so
                        we inherit all the thumbnail resolution + NSFW
                        handling already shipped in the rest of the app.
                        The type-icon corner badge is overlaid here at
                        the row level (notification-specific UI). */}
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
