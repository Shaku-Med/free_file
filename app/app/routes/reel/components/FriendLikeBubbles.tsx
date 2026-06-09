import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Heart } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";

type Friend = {
  id: string;
  username: string;
  profile_pic: string;
  verified?: boolean;
};

/**
 * Per-session cache so swiping back to a reel doesn't refetch its friend-likes.
 * Keyed by viewer id + file id: this data is personalized to the logged-in viewer,
 * so a different viewer (e.g. after a logout/login in the same SPA session) must
 * never read another viewer's cached entries.
 */
const friendsCache = new Map<string, Friend[]>();
const friendsInflight = new Map<string, Promise<Friend[]>>();

function loadFriendLikes(cacheKey: string, fileId: string): Promise<Friend[]> {
  const cached = friendsCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  let inflight = friendsInflight.get(cacheKey);
  if (!inflight) {
    inflight = fetch(`/api/reel-friend-likes?file_id=${encodeURIComponent(fileId)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: Friend[] = Array.isArray(d?.friends) ? d.friends : [];
        friendsCache.set(cacheKey, list);
        return list;
      })
      .catch(() => [])
      .finally(() => {
        friendsInflight.delete(cacheKey);
      });
    friendsInflight.set(cacheKey, inflight);
  }
  return inflight;
}

/** Distance (px) the cluster must be flung before it's dismissed. */
const DISMISS_PX = 90;
/** Fully transparent by this distance, so the drag feels like "throwing it away". */
const FADE_PX = 150;

/**
 * Instagram-style floating "friends who liked this" bubbles: up to 3 overlapping
 * avatars (each with a little heart badge). The viewer can drag the cluster away to
 * dismiss it. Resets when the reel (fileId) changes.
 */
export function FriendLikeBubbles({
  fileId,
  viewerId,
  enabled = true,
}: {
  fileId: string | undefined;
  viewerId?: string | null;
  enabled?: boolean;
}) {
  const cacheKey = fileId ? `${viewerId ?? "anon"}:${fileId}` : "";
  const [friends, setFriends] = useState<Friend[]>(
    () => (cacheKey ? friendsCache.get(cacheKey) ?? [] : []),
  );
  const [dismissed, setDismissed] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setDismissed(false);
    setDrag(null);
    startRef.current = null;
    if (!enabled || !fileId || !cacheKey) {
      setFriends([]);
      return;
    }
    const cached = friendsCache.get(cacheKey);
    if (cached) {
      setFriends(cached);
      return;
    }
    let cancelled = false;
    loadFriendLikes(cacheKey, fileId).then((list) => {
      if (!cancelled) setFriends(list);
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, cacheKey, enabled]);

  if (dismissed || friends.length === 0) return null;

  const shown = friends.slice(0, 3);
  const dragX = drag?.x ?? 0;
  const dragY = drag?.y ?? 0;
  const dist = Math.hypot(dragX, dragY);
  const opacity = Math.max(0, 1 - dist / FADE_PX);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0 });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    e.stopPropagation();
    setDrag({ x: e.clientX - startRef.current.x, y: e.clientY - startRef.current.y });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    startRef.current = null;
    if (Math.hypot(dx, dy) > DISMISS_PX) {
      setDismissed(true);
      return;
    }
    setDrag(null); // snap back
  };

  const names = shown.map((f) => f.username).filter(Boolean).join(", ");
  const dragging = drag !== null;

  return (
    // Outer wrapper owns the gentle floating bob (paused while dragging so it
    // doesn't fight the drag transform on the inner element).
    <div
      className="reel-friend-floaty pointer-events-none w-fit"
      style={dragging ? { animationPlayState: "paused" } : undefined}
    >
      <div
        className="swiper-no-swiping pointer-events-auto inline-flex w-fit cursor-grab touch-none select-none items-center active:cursor-grabbing"
        style={{
          transform: `translate(${dragX}px, ${dragY}px)`,
          opacity,
          transition: dragging ? "none" : "transform 200ms ease, opacity 200ms ease",
        }}
        role="group"
        aria-label={names ? `Liked by ${names}. Drag away to dismiss.` : "Friends who liked this"}
        title={names || undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex -space-x-2.5 drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]">
          {shown.map((f) => (
            <div key={f.id} className="relative">
              <Avatar className="h-8 w-8 border-2 border-black/60 shadow-[0_2px_6px_rgba(0,0,0,0.55)]">
                <AvatarImage src={getProfilePicUrl(f.profile_pic)} alt={f.username} loading="lazy" />
                <AvatarFallback className="text-[10px]">
                  {(f.username || "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-0.5 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 shadow ring-2 ring-black/50">
                <Heart className="h-2.5 w-2.5 fill-white text-white" aria-hidden />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
