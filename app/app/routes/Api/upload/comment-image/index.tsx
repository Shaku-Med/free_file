import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { getCookie } from "~/lib/Security/Token";
import db from "~/lib/Database/supabase";
import { arrangeDateForThumbnail } from "~/lib/utils";
import { isDbAdultFlag } from "~/lib/isDbAdultFlag.server";

const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024;

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await isAuthenticated(request, ["id"]);
  if (!user || !user.id) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const cUser = getCookie("c_user", request.headers);
  if (!cUser) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const uploadServerUrl = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || "").replace(
    /\/$/,
    "",
  );
  if (!uploadServerUrl) {
    return data({ error: "Upload server not configured" }, { status: 503 });
  }

  if (!db) {
    return data({ error: "Database not available" }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return data({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_COMMENT_IMAGE_BYTES) {
      return data({ error: "File exceeds 10MB limit" }, { status: 400 });
    }

    const fileIdRaw = formData.get("file_id");
    if (typeof fileIdRaw !== "string" || !fileIdRaw.trim()) {
      return data({ error: "file_id is required" }, { status: 400 });
    }
    const fileId = fileIdRaw.trim();
    if (!uuidRe.test(fileId)) {
      return data({ error: "Invalid file_id" }, { status: 400 });
    }

    const { data: fileRow, error: fileErr } = await db
      .from("files")
      .select("id, unique_id, is_adult, created_at, comments_enabled")
      .eq("id", fileId)
      .maybeSingle();

    if (fileErr) {
      console.error("[comment-image] file lookup:", fileErr);
      return data({ error: "Failed to verify file" }, { status: 500 });
    }
    if (!fileRow) {
      return data({ error: "File not found" }, { status: 404 });
    }
    if (fileRow.comments_enabled === false) {
      return data({ error: "Comments are disabled for this file" }, { status: 403 });
    }

    const uniqueId = fileRow.unique_id != null ? String(fileRow.unique_id).trim() : "";
    if (!uniqueId) {
      return data({ error: "File metadata incomplete" }, { status: 500 });
    }

    const createdAt = fileRow.created_at != null ? String(fileRow.created_at) : "";
    if (!createdAt) {
      return data({ error: "File metadata incomplete" }, { status: 500 });
    }

    const dateFolder = arrangeDateForThumbnail(createdAt);
    const isAdult = isDbAdultFlag(fileRow.is_adult);

    const proxyForm = new FormData();
    proxyForm.append("file", file);
    proxyForm.append("date_folder", dateFolder);
    proxyForm.append("unique_id", uniqueId);
    proxyForm.append("is_adult", isAdult ? "true" : "false");

    const res = await fetch(`${uploadServerUrl}/api/comment-image/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cUser}`,
      },
      body: proxyForm,
    });

    const json = await res.json();
    return data(json, { status: res.status });
  } catch (error: unknown) {
    console.error("[comment-image] Proxy to GoUpload failed:", error);
    return data({ error: "Upload failed" }, { status: 500 });
  }
};
