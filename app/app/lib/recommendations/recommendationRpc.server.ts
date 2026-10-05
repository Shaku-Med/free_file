import db from "~/lib/Database/supabase";

/**
 * Feed and related lists, ranked with the viewer's taste vector
 * (database/migrations/taste_vector_recommendations.sql).
 *
 * That SQL is run by hand, so this ships ahead of it safely: until the new
 * functions exist, every call quietly lands on the original ones. If the new
 * ones fail for any other reason, that is logged and the original answers
 * instead, because a feed that is slightly less personal beats one that is
 * missing.
 */

const TASTE_AWARE = {
  get_feed: "get_feed_v8",
  get_related: "get_related_v7",
} as const;

type RecommendationFn = keyof typeof TASTE_AWARE;

/** Parameters only the new functions understand; stripped for the fallback. */
const TASTE_ONLY_PARAMS = ["p_taste_weight"];

/**
 * How far the viewer's taste bends a related list away from the video itself.
 * The sidebar is about the video. Up next and the reel swipe are about what this
 * person will watch next, so they lean further.
 */
export const TASTE_WEIGHT = {
  sidebar: 1.0,
  upNext: 1.75,
} as const;

/** PostgREST and Postgres codes for "no such function": the SQL is not run yet. */
const NOT_MIGRATED = new Set(["PGRST202", "42883"]);

// Once per process per problem, so a missing migration or a broken query is
// visible in the logs without writing a line on every single request.
const reported = new Set<string>();
function reportOnce(key: string, log: () => void) {
  if (reported.has(key)) return;
  reported.add(key);
  log();
}

type RpcResult = { data: any; error: { code?: string; message?: string } | null };

export async function recommendationRpc(
  fn: RecommendationFn,
  params: Record<string, unknown>,
): Promise<RpcResult> {
  const preferred = TASTE_AWARE[fn];
  const res: RpcResult = await db.rpc(preferred, params);
  if (!res.error) return res;

  const code = res.error.code ?? "unknown";
  if (NOT_MIGRATED.has(code)) {
    reportOnce(`${preferred}:missing`, () =>
      console.warn(
        `[recommendations] ${preferred} is not in the database yet, using ${fn}. ` +
          "Run database/migrations/taste_vector_recommendations.sql to enable taste ranking.",
      ),
    );
  } else {
    reportOnce(`${preferred}:${code}`, () =>
      console.error(`[recommendations] ${preferred} failed, falling back to ${fn}:`, res.error),
    );
  }

  const legacy = { ...params };
  for (const key of TASTE_ONLY_PARAMS) delete legacy[key];
  const fallback: RpcResult = await db.rpc(fn, legacy);
  // The old functions do not shelve shorts. With no shelf id the page groups
  // them the way it always has instead of showing one short per shelf.
  if (Array.isArray(fallback.data)) {
    for (const row of fallback.data) row.feed_reel_cluster_id = null;
  }
  return fallback;
}
