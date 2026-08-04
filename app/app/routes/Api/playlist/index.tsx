import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { normalizeRpcFileRow } from "~/lib/profile/normalizeRpcFileRow";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";

const PAGE_SIZE = 12;

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { file_ids?: string[]; page?: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fileIds = Array.isArray(body?.file_ids)
    ? body.file_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  const uuidLike = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  const validFileIds = fileIds.filter(uuidLike);

  if (validFileIds.length === 0) {
    return new Response(
      JSON.stringify({ data: [], userActions: { likedFileIds: [], dislikedFileIds: [] }, hasMore: false }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const page = Math.max(1, Number(body?.page) || 1);
  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageIds = validFileIds.slice(start, end);
  const hasMore = end < validFileIds.length;

  if (pageIds.length === 0) {
    return new Response(
      JSON.stringify({ data: [], userActions: { likedFileIds: [], dislikedFileIds: [] }, hasMore: false }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  if (!db) {
    return new Response(JSON.stringify({ error: "Database unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const userId: string | undefined = user?.id || undefined;

  let fileList: any[] = [];
  const rpcResult = await db.rpc("get_files_by_ids", { p_ids: pageIds });

  if (rpcResult.error) {
    const isMissingRpc = rpcResult.error.code === "PGRST202";
    if (isMissingRpc) {
      const { data: directFiles, error: directError } = await db
        .from("files")
        .select(
          `id, created_at, endpoint, filename, unique_id, file_size, file_type,
           is_adult, owner_id, is_public, visibility, file_description, file_title,
           default_thumbnail, view_count, share_count, is_reel, is_music, duration,
           categories, tags, colors, metadata, upload_status`
        )
        .in("id", pageIds)
        .in("upload_status", ["complete", "completed"]);

      if (directError) {
        console.error("Playlist fetch error:", directError);
        return new Response(JSON.stringify({ error: "Failed to fetch playlist" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      const raw = directFiles || [];
      const key = (id: string) => String(id).toLowerCase();
      const fileMap = new Map(raw.map((f: any) => [key(f.id), f]));
      fileList = pageIds.map((id) => fileMap.get(key(id))).filter(Boolean);
      const ownerIds = [...new Set(fileList.map((f: any) => f.owner_id).filter(Boolean))];
      if (ownerIds.length > 0) {
        const { data: owners } = await db
          .from("users")
          .select("id, username, profile_pic, verified")
          .in("id", ownerIds);
        const ownerMap = new Map((owners || []).map((u: any) => [String(u.id), u]));
        fileList.forEach((f: any) => {
          f.owner = f.owner_id ? ownerMap.get(String(f.owner_id)) ?? null : null;
        });
      }
    } else {
      console.error("Playlist fetch error:", rpcResult.error);
      return new Response(JSON.stringify({ error: "Failed to fetch playlist" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    fileList = Array.isArray(rpcResult.data) ? rpcResult.data : [];
  }
  // Access control: this endpoint returns metadata for arbitrary client-supplied
  // file ids, so we MUST drop any file the requester isn't allowed to see
  // (private / age-gated). Otherwise private files are enumerable by UUID.
  fileList = await filterFilesByAccess(request, fileList as any[]);
  const ids = fileList.map((f: any) => f.id).filter(Boolean);
  const interactionsByFile = new Map<
    string,
    { like_count: number; dislike_count: number; comment_count: number; user_has_liked: boolean; user_has_disliked: boolean }
  >();
  if (ids.length > 0) {
    const { data: batch } = await db.rpc("get_batch_interactions", {
      p_file_ids: ids,
      p_user_id: userId || null,
    });
    if (Array.isArray(batch)) {
      for (const row of batch) {
        if (row?.file_id) {
          interactionsByFile.set(String(row.file_id), {
            like_count: Number(row.like_count) ?? 0,
            dislike_count: Number(row.dislike_count) ?? 0,
            comment_count: Number(row.comment_count) ?? 0,
            user_has_liked: !!row.user_has_liked,
            user_has_disliked: !!row.user_has_disliked,
          });
        }
      }
    }
  }

  const likedFileIds: string[] = [];
  const dislikedFileIds: string[] = [];
  const ordered = fileList.map((file: any) => {
    const interactions = file.id ? interactionsByFile.get(String(file.id)) : undefined;
    const likeCount = interactions ? interactions.like_count : 0;
    const dislikeCount = interactions ? interactions.dislike_count : 0;
    const commentCount = interactions ? interactions.comment_count : 0;
    if (interactions?.user_has_liked) likedFileIds.push(String(file.id));
    if (interactions?.user_has_disliked) dislikedFileIds.push(String(file.id));
    const owner = file.owner
      ? {
          id: file.owner.id,
          username: file.owner.username,
          profile_pic: file.owner.profile_pic || "",
          verified: file.owner.verified ?? false,
        }
      : file.owner_username != null
        ? {
            id: file.owner_id,
            username: file.owner_username,
            profile_pic: file.owner_profile_pic || "",
            verified: file.owner_verified ?? false,
          }
        : null;
    return normalizeRpcFileRow({
      id: file.id,
      created_at: file.created_at,
      endpoint: file.endpoint || "",
      filename: file.filename,
      unique_id: file.unique_id,
      file_size: file.file_size,
      file_type: file.file_type,
      is_adult: file.is_adult,
      owner_id: file.owner_id,
      is_public: file.is_public,
      file_description: file.file_description,
      file_title: file.file_title || "",
      default_thumbnail: file.default_thumbnail || null,
      preview_endpoint: file.preview_endpoint || null,
      view_count: file.view_count,
      share_count: file.share_count,
      is_reel: file.is_reel,
      duration: file.duration,
      categories: file.categories,
      tags: file.tags,
      colors: file.colors,
      metadata: file.metadata,
      like_count: likeCount,
      dislike_count: dislikeCount,
      comment_count: commentCount,
      owner,
    } as Record<string, unknown>);
  });

  return new Response(
    JSON.stringify({
      data: ordered,
      userActions: { likedFileIds, dislikedFileIds },
      hasMore,
      page,
      total: validFileIds.length,
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
};
