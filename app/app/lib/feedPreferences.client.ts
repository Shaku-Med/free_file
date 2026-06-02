import { signedFetch } from "~/lib/Security/requestSigning.client";
import { toast } from "~/components/ui/sonner";

export type FeedPrefTargetType = "file" | "user";

// One-call hide. Shows a toast on success/failure. Returns true on success so
// the caller can update local state (e.g. drop the card from the feed view).
export async function hideFromFeed(
  targetType: FeedPrefTargetType,
  targetId: string,
  options: { successText?: string; reason?: string } = {},
): Promise<boolean> {
  try {
    const res = await signedFetch("/api/feed-preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_type: targetType,
        target_id: targetId,
        reason: options.reason ?? null,
      }),
    });
    if (res.status === 403) {
      toast.error("You can't hide your own content.");
      return false;
    }
    if (!res.ok) {
      toast.error("Couldn't save your preference. Try again.");
      return false;
    }
    toast.success(options.successText ?? "We'll show less of this.");
    return true;
  } catch {
    toast.error("Couldn't save your preference. Try again.");
    return false;
  }
}

export async function unhideFromFeed(
  targetType: FeedPrefTargetType,
  targetId: string,
): Promise<boolean> {
  try {
    const res = await signedFetch("/api/feed-preferences", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_type: targetType, target_id: targetId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
