import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import { stripGithubRepoForClient } from "~/lib/githubStorage";

/**
 * Returns the data needed to render a single content card (feed hero / PiP).
 * Mirrors a trimmed subset of the Dynamic route loader — no related videos,
 * no series, no channel stats. Looks up by `unique_id`.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const id = params.id;
  if (!id) return data({ error: "Missing id" }, { status: 400 });
  if (!db) return data({ error: "Database not initialized" }, { status: 500 });

  const { data: rawFile, error } = await db
    .from("files")
    .select("*")
    .eq("unique_id", id)
    .maybeSingle();

  if (error) {
    console.error("[api/content/:id] fetch error:", error);
    return data({ error: "Failed to fetch" }, { status: 500 });
  }

  if (!rawFile) {
    return data(
      { file: null, id, accessDenied: false, reason: undefined, userId: null },
      { status: 404 },
    );
  }

  const stripped = stripGithubRepoForClient(
    rawFile as Record<string, unknown>,
  ) as Record<string, unknown>;
  const { thumbnails: _omit, ...fileRest } = stripped;
  const file = fileRest as Record<string, unknown> & {
    id?: string;
    owner_id?: string;
    is_adult?: boolean;
    is_public?: boolean;
  };

  const access = await checkFileAccess(
    request,
    file as unknown as {
      is_adult: boolean;
      is_public: boolean;
      owner_id: string;
    },
  );
  if (!access.allowed) {
    return data(
      {
        file: null,
        id,
        accessDenied: true as const,
        reason: access.reason,
        userId: null,
      },
      { status: 403 },
    );
  }

  const user = await isAuthenticated(request, ["id"]);
  const userId = user?.id ?? null;

  let likeCount = 0;
  let dislikeCount = 0;
  let commentCount = 0;
  let userLiked = false;
  let userDisliked = false;

  if (file.id) {
    const { data: interactionsData } = await db.rpc("get_file_interactions", {
      p_file_id: file.id,
      p_user_id: userId,
    });
    const row = Array.isArray(interactionsData)
      ? interactionsData[0]
      : interactionsData;
    if (row) {
      likeCount = Number(row.like_count) || 0;
      dislikeCount = Number(row.dislike_count) || 0;
      commentCount = Number(row.comment_count) || 0;
      userLiked = !!row.user_has_liked;
      userDisliked = !!row.user_has_disliked;
    }
  }

  let owner: {
    id: string;
    username: string;
    profile_pic: string;
    verified: boolean;
  } | null = null;

  if (file.owner_id) {
    const { data: ownerRow } = await db
      .from("users")
      .select("id, username, profile_pic, verified")
      .eq("id", file.owner_id)
      .maybeSingle();

    if (ownerRow) {
      owner = {
        id: String(ownerRow.id),
        username: String(ownerRow.username),
        profile_pic: String(ownerRow.profile_pic ?? ""),
        verified: Boolean(ownerRow.verified ?? false),
      };
    }
  }

  return data(
    {
      file,
      id,
      userId,
      owner,
      likeCount,
      dislikeCount,
      commentCount,
      userLiked,
      userDisliked,
      accessDenied: false as const,
      reason: undefined,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
};
