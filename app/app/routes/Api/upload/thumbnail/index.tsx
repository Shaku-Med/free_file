import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { mintUploadBearerForRequest } from "~/lib/Security/uploadToken.server";
import db from "~/lib/Database/supabase";
import { arrangeDateForThumbnail } from "~/lib/utils";
import { isDbAdultFlag } from "~/lib/isDbAdultFlag.server";

const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;

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

  const uploadBearer = await mintUploadBearerForRequest(request, user.id);
  if (!uploadBearer) {
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
    if (file.size > MAX_THUMBNAIL_BYTES) {
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
      .select("id, unique_id, is_adult, created_at, file_type, owner_id")
      .eq("id", fileId)
      .maybeSingle();

    if (fileErr) {
      console.error("[upload/thumbnail] file lookup:", fileErr);
      return data({ error: "Failed to verify file" }, { status: 500 });
    }
    if (!fileRow) {
      return data({ error: "File not found" }, { status: 404 });
    }
    if (String(fileRow.owner_id) !== String(user.id)) {
      return data({ error: "Forbidden" }, { status: 403 });
    }

    const fileType = fileRow.file_type != null ? String(fileRow.file_type) : "";
    if (fileType.toLowerCase().startsWith("image/")) {
      return data({ error: "Thumbnail cannot be changed for image files" }, { status: 400 });
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
    proxyForm.append("unique_id", uniqueId);
    proxyForm.append("date_folder", dateFolder);
    proxyForm.append("file_type", fileType || "application/octet-stream");
    proxyForm.append("is_adult", isAdult ? "true" : "false");

    const res = await fetch(`${uploadServerUrl}/api/thumbnail/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${uploadBearer}`,
      },
      body: proxyForm,
    });

    const json = await res.json();
    return data(json, { status: res.status });
  } catch (error: unknown) {
    console.error("[upload/thumbnail] proxy failed:", error);
    return data({ error: "Upload failed" }, { status: 500 });
  }
};
