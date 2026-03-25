import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { Bell, BellOff, Loader2, ChevronDown } from "lucide-react";
import { cn } from "~/lib/utils";

interface SubscribeButtonProps {
  channelId: string;
  currentUserId: string | null;
  initialSubscribed: boolean;
  initialNotify: boolean;
  initialCount: number;
  isOwner?: boolean;
  compact?: boolean;
}

export function formatSubscriberCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export default function SubscribeButton({
  channelId,
  currentUserId,
  initialSubscribed,
  initialNotify,
  initialCount,
  isOwner = false,
  compact = false,
}: SubscribeButtonProps) {
  const navigate = useNavigate();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [notify, setNotify] = useState(initialNotify);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [bellBusy, setBellBusy] = useState(false);

  const requireAuth = useCallback(() => {
    const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    navigate(`/auth/login?redirect=${encodeURIComponent(next)}`);
  }, [navigate]);

  const handleToggle = useCallback(async () => {
    if (!currentUserId) { requireAuth(); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channel_id: channelId, action: "toggle" }),
      });
      if (res.status === 401) { requireAuth(); return; }
      const json = await res.json();
      if (json.success) {
        setSubscribed(json.subscribed);
        if (typeof json.subscriber_count === "number") {
          setCount(json.subscriber_count);
        } else {
          setCount((c) => (json.subscribed ? c + 1 : Math.max(0, c - 1)));
        }
        if (json.subscribed) setNotify(true);
      }
    } catch {}
    finally { setBusy(false); }
  }, [channelId, currentUserId, requireAuth]);

  const handleBellToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || !subscribed) return;
    setBellBusy(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channel_id: channelId, action: "toggle_notify" }),
      });
      const json = await res.json();
      if (json.success) {
        setNotify(json.notify);
      }
    } catch {}
    finally { setBellBusy(false); }
  }, [channelId, currentUserId, subscribed]);

  if (isOwner) return null;

  const iconSize = compact ? "w-3.5 h-3.5" : "w-4 h-4";

  // Not subscribed — single rounded pill
  if (!subscribed) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={handleToggle}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full font-medium bg-foreground text-background hover:bg-foreground/80 transition-colors disabled:opacity-60",
          compact ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm"
        )}
      >
        {busy ? <Loader2 className={cn(iconSize, "animate-spin")} /> : "Subscribe"}
      </button>
    );
  }

  // Subscribed — grouped pill: [Subscribed ▾ | 🔔]
  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-full bg-muted",
        compact ? "text-xs" : "text-sm"
      )}
      role="group"
    >
      {/* Subscribe toggle */}
      <button
        type="button"
        disabled={busy}
        onClick={handleToggle}
        className={cn(
          "inline-flex items-center gap-1 font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60",
          compact ? "px-3 py-1" : "px-4 py-2"
        )}
      >
        {busy ? (
          <Loader2 className={cn(iconSize, "animate-spin")} />
        ) : (
          <>
            <Bell className={cn(iconSize, "shrink-0")} />
            Subscribed
            <ChevronDown className={cn(compact ? "w-3 h-3" : "w-3.5 h-3.5", "shrink-0 opacity-60")} />
          </>
        )}
      </button>

      {/* Divider */}
      <div className="w-px bg-border self-stretch" />

      {/* Bell toggle */}
      <button
        type="button"
        disabled={bellBusy}
        onClick={handleBellToggle}
        className={cn(
          "inline-flex items-center justify-center transition-colors hover:bg-accent disabled:opacity-60",
          compact ? "px-2 py-1" : "px-3 py-2"
        )}
        aria-label={notify ? "Notifications on — click to turn off" : "Notifications off — click to turn on"}
        title={notify ? "Notifications on" : "Notifications off"}
      >
        {bellBusy ? (
          <Loader2 className={cn(iconSize, "animate-spin")} />
        ) : notify ? (
          <Bell className={cn(iconSize, "text-foreground")} />
        ) : (
          <BellOff className={cn(iconSize, "text-muted-foreground")} />
        )}
      </button>
    </div>
  );
}
