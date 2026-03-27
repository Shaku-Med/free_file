import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";

const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024; // keep in sync with GoUpload commentimg maxFileSize

/**
 * Comment image upload endpoint.
 * This proxies the upload to the GoUpload server which handles:
 * - NSFW detection via the co-located NSFWAPI
 * - GitHub storage
 *
 * If no GoUpload server is configured, falls back to rejecting with an error.
 */
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await isAuthenticated(request, ["id"]);
  if (!user || !user.id) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const uploadServerUrl = process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL;
  if (!uploadServerUrl) {
    return data({ error: "Upload server not configured" }, { status: 503 });
  }

  try {
    // Forward the multipart form to GoUpload
    const formData = await request.formData();
    const proxyForm = new FormData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return data({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_COMMENT_IMAGE_BYTES) {
      return data({ error: "File exceeds 10MB limit" }, { status: 400 });
    }
    proxyForm.append("file", file);
    const dateFolder = formData.get("date_folder");
    const uniqueId = formData.get("unique_id");
    if (typeof dateFolder === "string" && dateFolder.trim()) {
      proxyForm.append("date_folder", dateFolder.trim());
    }
    if (typeof uniqueId === "string" && uniqueId.trim()) {
      proxyForm.append("unique_id", uniqueId.trim());
    }

    const res = await fetch(`${uploadServerUrl}/api/comment-image/upload`, {
      method: "POST",
      headers: {
        "X-User-ID": user.id,
      },
      body: proxyForm,
    });

    const json = await res.json();
    return data(json, { status: res.status });
  } catch (error: any) {
    console.error("[comment-image] Proxy to GoUpload failed:", error);
    return data({ error: "Upload failed" }, { status: 500 });
  }
};
