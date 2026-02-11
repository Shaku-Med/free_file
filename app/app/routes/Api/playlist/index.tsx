import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";

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

  if (fileIds.length === 0) {
    return new Response(
      JSON.stringify({ data: [], userActions: { likedFileIds: [], dislikedFileIds: [] }, hasMore: false }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const page = Math.max(1, Number(body?.page) || 1);
  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageIds = fileIds.slice(start, end);
  const hasMore = end < fileIds.length;

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

  const { data: files, error } = await db
    .from("files")
    .select(
      `id, created_at, endpoint, filename, unique_id, file_size, file_type,
       is_adult, owner_id, is_public, file_description, file_title,
       thumbnails, view_count, share_count, is_reel, duration,
       categories, tags, colors, metadata, upload_status,
       owner:users!files_owner_id_fkey(id, username, profile_pic, verified)`
    )
    .in("id", pageIds)
    .in("upload_status", ["complete", "completed"]);

  if (error) {
    console.error("Playlist fetch error:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch playlist" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fileMap = new Map((files || []).map((f: any) => [f.id, f]));
  const ordered = pageIds
    .map((id) => fileMap.get(id))
    .filter(Boolean)
    .map((file: any) => ({
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
      thumbnails: file.thumbnails || [],
      view_count: file.view_count,
      share_count: file.share_count,
      is_reel: file.is_reel,
      duration: file.duration,
      categories: file.categories,
      tags: file.tags,
      colors: file.colors,
      metadata: file.metadata,
      like_count: 0,
      dislike_count: 0,
      comment_count: 0,
      owner: file.owner
        ? {
            id: file.owner.id,
            username: file.owner.username,
            profile_pic: file.owner.profile_pic || "",
            verified: file.owner.verified ?? false,
          }
        : null,
    }));

  let likedFileIds: string[] = [];
  let dislikedFileIds: string[] = [];

  if (userId && ordered.length > 0) {
    const ids = ordered.map((f: any) => f.id);
    const [likesRes, dislikesRes] = await Promise.all([
      db.from("likes").select("file_id").eq("user_id", userId).in("file_id", ids),
      db.from("dislike").select("file_id").eq("user_id", userId).in("file_id", ids),
    ]);
    likedFileIds = (likesRes.data || []).map((r: any) => r.file_id);
    dislikedFileIds = (dislikesRes.data || []).map((r: any) => r.file_id);
  }

  return new Response(
    JSON.stringify({
      data: ordered,
      userActions: { likedFileIds, dislikedFileIds },
      hasMore,
      page,
      total: fileIds.length,
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
};
