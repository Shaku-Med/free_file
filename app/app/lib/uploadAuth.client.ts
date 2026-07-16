export type UploadAuthContext = {
  bearer: string;
  base: string;
};

/**
 * =============================================================================
 * UPLOAD AUTH (GoUpload only) — preferred client entry for uploads
 * =============================================================================
 *
 * DO NOT add fallbacks to POST /api/upload. All uploads must go to GoUpload.
 *
 * See also: MediaSelectionModal.tsx (uploadToGo), GoUpload/main.go, .env
 * UPLOAD_SERVER_URL / GO_UPLOAD_URL.
 * =============================================================================
 *
 * Mints a short-lived upload-scoped bearer from the HttpOnly c_user cookie
 * (server-side). Never receives the session JWT itself.
 */
export async function fetchUploadAuthContext(): Promise<UploadAuthContext> {
  const authRes = await fetch("/api/upload/auth", {
    credentials: "include",
    headers: { "X-Requested-With": "fetch" },
  });
  if (authRes.status === 401) {
    throw new Error("Please log in to upload.");
  }
  if (!authRes.ok) {
    const j = (await authRes.json().catch(() => null)) as { error?: string } | null;
    if (j?.error === "upload_server_not_configured") {
      throw new Error("Upload server is offline. Try again later.");
    }
    throw new Error("Upload server is offline. Try again later.");
  }

  const json = (await authRes.json()) as {
    bearer?: string;
    upload_server_url?: string;
  };
  const bearer = json.bearer?.trim();
  const base = json.upload_server_url?.replace(/\/$/, "") ?? "";
  if (!bearer || !base) {
    throw new Error("Upload server is offline. Try again later.");
  }

  try {
    const health = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok) {
      throw new Error("Upload server is offline. Try again later.");
    }
  } catch (e) {
    if (e instanceof Error && e.message === "Upload server is offline. Try again later.") {
      throw e;
    }
    throw new Error("Upload server is offline. Try again later.");
  }

  return { bearer, base };
}
