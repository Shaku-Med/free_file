import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { UserProfileRow } from "~/components/UserProfileRow";

export type CommentLikeUser = {
  id: string;
  username: string;
  profile_pic: string;
  subscriber_count: number;
  is_subscribed: boolean;
  notify: boolean;
};

type CommentLikesModalProps = {
  commentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId?: string | null;
};

export function CommentLikesModal({
  commentId,
  open,
  onOpenChange,
  currentUserId,
}: CommentLikesModalProps) {
  const [users, setUsers] = useState<CommentLikeUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !commentId) return;
    setLoading(true);
    setError(null);
    setUsers([]);
    const q = new URLSearchParams({ commentId });
    fetch(`/api/comment-likes?${q.toString()}`, { credentials: "include" })
      .then(async (r) => {
        const j = (await r.json()) as {
          success?: boolean;
          users?: CommentLikeUser[];
          error?: string;
        };
        if (!r.ok) throw new Error(j.error || "Failed to load likes");
        setUsers(Array.isArray(j.users) ? j.users : []);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load likes")
      )
      .finally(() => setLoading(false));
  }, [open, commentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-base font-semibold">Likes</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[min(70vh,520px)]">
          <div className="px-3 py-2 sm:px-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                <span>Loading…</span>
              </div>
            ) : error ? (
              <p className="px-2 py-8 text-center text-sm text-destructive">{error}</p>
            ) : users.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">No likes yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 pb-2">
                {users.map((u) => (
                  <li key={u.id} className="rounded-lg border border-border/50 bg-card/30 px-2 py-2 sm:px-3">
                    <UserProfileRow
                      userId={u.id}
                      username={u.username}
                      profilePic={u.profile_pic}
                      subscriberCount={u.subscriber_count}
                      isSubscribed={u.is_subscribed}
                      notify={u.notify}
                      currentUserId={currentUserId}
                      compact
                      onNavigate={() => onOpenChange(false)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
