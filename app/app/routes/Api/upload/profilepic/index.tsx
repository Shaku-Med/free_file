import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { getCookie } from "~/lib/Security/Token";
import db from "~/lib/Database/supabase";
import { GitHubClient } from "~/lib/Github/GitHubClient";
import { config } from "~/lib/config";
import { deleteOldProfilePicIfNeeded, githubRepoForProfile } from "~/lib/profilePicGithub.server";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await isAuthenticated(request, ["id", "username"]);
  if (!user || !user.id) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const cUser = getCookie("c_user", request.headers);
  if (!cUser) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const uploadBase = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || "").replace(/\/$/, "");
  if (!uploadBase) {
    return data({ error: "Profile picture uploads require the upload server (UPLOAD_SERVER_URL)." }, { status: 503 });
  }

  if (!db) {
    return data({ error: "Database not available" }, { status: 500 });
  }

  const username = user.username;
  if (!username) {
    return data({ error: "Username not found" }, { status: 500 });
  }

  if (!config.github.token || !config.github.owner) {
    return data({ error: "GitHub configuration missing" }, { status: 500 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return data({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return data({ error: "Invalid file type. Only images are allowed" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return data({ error: "File size exceeds 10MB limit" }, { status: 400 });
  }

  const { data: currentUser } = await db
    .from("users")
    .select("profile_pic")
    .eq("id", user.id)
    .maybeSingle();

  const forward = new FormData();
  forward.append("file", file, file.name || "profile.jpg");

  let goRes: Response;
  try {
    goRes = await fetch(`${uploadBase}/api/profilepic/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cUser}` },
      body: forward,
    });
  } catch (e) {
    console.error("[profilepic] Go upload request failed:", e);
    return data({ error: "Profile picture upload service unavailable" }, { status: 502 });
  }

  const goJson = (await goRes.json().catch(() => ({}))) as {
    error?: string;
    nsfw?: boolean;
    success?: boolean;
    profile_pic?: string;
  };

  if (goRes.status === 422 && goJson.nsfw) {
    return data(
      {
        error:
          goJson.error ||
          "This image was detected as inappropriate and cannot be used as a profile picture",
        nsfw: true,
      },
      { status: 422 },
    );
  }

  if (!goRes.ok) {
    return data(
      { error: goJson.error || "Profile picture upload failed" },
      { status: goRes.status >= 400 && goRes.status < 600 ? goRes.status : 502 },
    );
  }

  if (!goJson.success || typeof goJson.profile_pic !== "string") {
    return data({ error: goJson.error || "Profile picture upload failed" }, { status: 502 });
  }

  const githubPath = goJson.profile_pic;

  const ghRepo = githubRepoForProfile();
  const githubClient = new GitHubClient(config.github.token, config.github.owner, ghRepo);
  try {
    await deleteOldProfilePicIfNeeded(githubClient, currentUser?.profile_pic, githubPath, username);
  } catch (e) {
    console.warn("[profilepic] old file cleanup:", e);
  }

  const { error: updateError } = await db.from("users").update({ profile_pic: githubPath }).eq("id", user.id);

  if (updateError) {
    return data({ error: "Failed to update profile picture in database" }, { status: 500 });
  }

  return data({ success: true, profile_pic: githubPath }, { status: 200 });
};
