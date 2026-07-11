import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const UUID_RE = /^[0-9a-f-]{36}$/i;

type FriendLiker = {
  id: string;
  username: string;
  profile_pic: string;
  verified: boolean;
};

/**
 * GET /api/reel-friend-likes?file_id=… — up to 3 "friends" who liked this reel,
 * for the Instagram-style floating like bubbles.
 *
 * A "friend" = someone in the viewer's orbit:
 *   • a channel the viewer subscribes to, OR
 *   • a creator the viewer watches a lot (user_creator_affinity).
 * We then intersect that candidate set with the users who actually LIKED the file.
 * Auth required: logged-out callers get 401 (the UI only calls this when signed in).
 */
export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) return toJson({ success: false }, 401);
    const me = String(user.id);

    const url = new URL(request.url);
    const fileId = url.searchParams.get("file_id");
    if (!fileId || !UUID_RE.test(fileId)) {
      return toJson({ success: false }, 400);
    }
    if (!db) return toJson({ success: false }, 503);

    // Candidate friends: channels I subscribe to + creators I watch a lot.
    const [subsRes, affRes] = await Promise.all([
      db.from("subscriptions").select("channel_id").eq("subscriber_id", me),
      db
        .from("user_creator_affinity")
        .select("creator_id")
        .eq("user_id", me)
        .order("affinity_score", { ascending: false })
        .limit(100),
    ]);

    const candidateSet = new Set<string>();
    if (Array.isArray(subsRes.data)) {
      for (const r of subsRes.data) {
        if (r?.channel_id) candidateSet.add(String(r.channel_id));
      }
    }
    if (Array.isArray(affRes.data)) {
      for (const r of affRes.data) {
        if (r?.creator_id) candidateSet.add(String(r.creator_id));
      }
    }
    candidateSet.delete(me);
    if (candidateSet.size === 0) return toJson({ success: true, friends: [] });

    const candidates = Array.from(candidateSet).slice(0, 300);

    // Of those candidates, who liked this reel? Cap at the few we need to show.
    const { data: likeRows } = await db
      .from("likes")
      .select("user_id")
      .eq("file_id", fileId)
      .in("user_id", candidates)
      .limit(3);

    const likerIds = Array.isArray(likeRows)
      ? [...new Set(likeRows.map((r) => String(r.user_id)).filter(Boolean))].slice(0, 3)
      : [];
    if (likerIds.length === 0) return toJson({ success: true, friends: [] });

    const { data: people } = await db
      .from("users")
      .select("id, username, profile_pic, verified")
      .in("id", likerIds);

    const byId = new Map(
      (Array.isArray(people) ? people : []).map((p) => [String(p.id), p]),
    );
    const friends: FriendLiker[] = likerIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        id: String(p.id),
        username: typeof p.username === "string" ? p.username : "",
        profile_pic: typeof p.profile_pic === "string" ? p.profile_pic : "",
        verified: Boolean(p.verified),
      }));

    return toJson({ success: true, friends });
  } catch {
    return toJson({ success: false }, 500);
  }
};
