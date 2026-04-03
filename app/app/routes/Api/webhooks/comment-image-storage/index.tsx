import db from "~/lib/Database/supabase";

/**
 * GoUpload calls this after storing a comment image in GitHub (same X-Webhook-Secret as upload-job-status).
 * Upserts storage_path → github_repo; CommentService consumes the row when the comment is inserted.
 */
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const secret =
    request.headers.get("X-Webhook-Secret") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  const expected = process.env.UPLOAD_WEBHOOK_SECRET ?? "";
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!db) {
    return new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { image_url?: string; github_repo?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const imageUrl = typeof body?.image_url === "string" ? body.image_url.trim() : "";
  const githubRepo = typeof body?.github_repo === "string" ? body.github_repo.trim() : "";
  if (!imageUrl || !githubRepo) {
    return new Response(JSON.stringify({ error: "image_url and github_repo required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await db.from("comment_image_upload_repos").upsert(
    { storage_path: imageUrl, github_repo: githubRepo },
    { onConflict: "storage_path" },
  );

  if (error) {
    console.error("[comment-image-storage webhook]", error);
    return new Response(JSON.stringify({ error: "upsert failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
