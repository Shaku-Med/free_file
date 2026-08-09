import { useCallback, useState } from "react";
import { Link } from "react-router";
import { UserPlus, X } from "lucide-react";
import { Carousel, CarouselItem } from "~/components/Carousel/Carousel";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { formatSubscriberCount } from "~/components/SubscribeButton";
import { cn } from "~/lib/utils";

export interface SuggestedCreator {
  id: string;
  username: string;
  profile_pic: string;
  verified: boolean;
  about: string | null;
  subscriber_count: number;
  mutual_count: number;
  reason: "mutual" | "popular";
}

type Props = {
  creators: SuggestedCreator[];
  currentUserId: string | null;
  title?: string;
  onDismissCreator?: (id: string) => void;
};

function reasonLabel(c: SuggestedCreator): string {
  if (c.reason === "mutual" && c.mutual_count > 0) {
    return `${c.mutual_count} mutual ${c.mutual_count === 1 ? "connection" : "connections"}`;
  }
  if (c.subscriber_count > 0) return `${formatSubscriberCount(c.subscriber_count)} subscribers`;
  return "Suggested for you";
}

function CreatorCard({
  creator,
  currentUserId,
  onDismiss,
}: {
  creator: SuggestedCreator;
  currentUserId: string | null;
  onDismiss: (id: string) => void;
}) {
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(async () => {
    if (!currentUserId) {
      const next =
        typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
      window.location.href = `/auth/login?redirect=${encodeURIComponent(next)}`;
      return;
    }
    setBusy(true);
    const optimistic = !subscribed;
    setSubscribed(optimistic);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channel_id: creator.id, action: "toggle" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.success !== true) setSubscribed(!optimistic);
      else if (typeof j.subscribed === "boolean") setSubscribed(j.subscribed);
    } catch {
      setSubscribed(!optimistic);
    } finally {
      setBusy(false);
    }
  }, [currentUserId, creator.id, subscribed]);

  return (
    <div className="relative flex h-full flex-col items-center rounded-xl border border-border/60 bg-card/40 p-4 text-center">
      <button
        type="button"
        onClick={() => onDismiss(creator.id)}
        aria-label={`Dismiss ${creator.username}`}
        className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <Link to={`/profile/${encodeURIComponent(creator.username)}`} className="flex flex-col items-center">
        <span className="h-16 w-16 overflow-hidden rounded-full ring-1 ring-border/60">
          <img
            src={getProfilePicUrl(creator.profile_pic) || creator.profile_pic}
            alt={creator.username}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0")}
          />
        </span>
        <span className="mt-2 block max-w-[8.5rem] truncate text-sm font-semibold text-foreground">
          {creator.username}
        </span>
      </Link>

      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{reasonLabel(creator)}</p>

      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={cn(
          "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
          subscribed
            ? "border border-border bg-transparent text-foreground hover:bg-muted"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {!subscribed && <UserPlus className="h-3.5 w-3.5" />}
        {subscribed ? "Subscribed" : "Subscribe"}
      </button>
    </div>
  );
}

export default function SuggestedCreatorsRow({
  creators,
  currentUserId,
  title = "People you may know",
  onDismissCreator,
}: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const handleDismiss = useCallback(
    (id: string) => {
      setDismissed((prev) => new Set(prev).add(id));
      onDismissCreator?.(id);
    },
    [onDismissCreator],
  );

  const visible = creators.filter((c) => !dismissed.has(c.id));
  if (visible.length === 0) return null;

  return (
    <div className="col-span-full min-w-0 py-2">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      </div>
      <Carousel label={title} itemWidth={150} gapClassName="gap-2.5">
        {visible.map((c) => (
          <CarouselItem key={c.id}>
            <CreatorCard creator={c} currentUserId={currentUserId} onDismiss={handleDismiss} />
          </CarouselItem>
        ))}
      </Carousel>
    </div>
  );
}
