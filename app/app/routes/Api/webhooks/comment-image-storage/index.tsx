import db from "~/lib/Database/supabase";
import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server";

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

  if (!verifyWebhookSecret(request)) {
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

  let body: { image_url?: string; github_repo?: string; storage_backend?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const imageUrl = typeof body?.image_url === "string" ? body.image_url.trim().slice(0, 512) : "";
  const githubRepo = typeof body?.github_repo === "string" ? body.github_repo.trim().slice(0, 128) : "";
  const storageBackend = body?.storage_backend === "r2" ? "r2" : "github";
  // GitHub needs a repo; R2 does not.
  if (!imageUrl || (storageBackend === "github" && !githubRepo)) {
    return new Response(JSON.stringify({ error: "image_url and github_repo required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await db.from("comment_image_upload_repos").upsert(
    { storage_path: imageUrl, github_repo: githubRepo, storage_backend: storageBackend },
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
