import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { getCookie } from "~/lib/Security/Token";
import db from "~/lib/Database/supabase";
import { GitHubClient } from "~/lib/Github/GitHubClient";
import { config } from "~/lib/config";
import { deleteOldProfilePicIfNeeded, githubRepoForProfilePath } from "~/lib/profilePicGithub.server";
import { isProfilePicPathForUser, validGitHubRepoName } from "~/lib/profilePicSecurity.server";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** No user-visible error strings — only flags for the client. */
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return data({ success: false }, { status: 405 });
  }

  const user = await isAuthenticated(request, ["id", "username"]);
  if (!user || !user.id) {
    return data({ success: false }, { status: 401 });
  }

  const cUser = getCookie("c_user", request.headers);
  if (!cUser) {
    return data({ success: false }, { status: 401 });
  }

  const uploadBase = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || "").replace(/\/$/, "");
  if (!uploadBase) {
    return data({ success: false }, { status: 503 });
  }

  if (!db) {
    return data({ success: false }, { status: 500 });
  }

  const username = user.username;
  if (!username) {
    return data({ success: false }, { status: 500 });
  }

  if (!config.github.token || !config.github.owner) {
    return data({ success: false }, { status: 500 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return data({ success: false }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return data({ success: false }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return data({ success: false }, { status: 400 });
  }

  const { data: currentUser } = await db
    .from("users")
    .select("profile_pic, github_repo")
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
    return data({ success: false }, { status: 502 });
  }

  const goJson = (await goRes.json().catch(() => ({}))) as {
    success?: boolean;
    nsfw?: boolean;
    profile_pic?: string;
    github_repo?: string;
  };

  if (goRes.status === 422 && goJson.nsfw) {
    return data({ success: false, nsfw: true }, { status: 422 });
  }

  if (!goRes.ok) {
    return data({ success: false }, { status: goRes.status >= 400 && goRes.status < 600 ? goRes.status : 502 });
  }

  if (!goJson.success || typeof goJson.profile_pic !== "string") {
    return data({ success: false }, { status: 502 });
  }

  const githubPath = goJson.profile_pic
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .trim();

  if (!isProfilePicPathForUser(githubPath, username, user.id)) {
    return data({ success: false }, { status: 502 });
  }

  const ghRepo = githubRepoForProfilePath(currentUser?.github_repo);
  const githubClient = new GitHubClient(config.github.token, config.github.owner, ghRepo);
  try {
    await deleteOldProfilePicIfNeeded(githubClient, currentUser?.profile_pic, githubPath, username);
  } catch (e) {
    console.warn("[profilepic] old file cleanup:", e);
  }

  const repoFromGo = typeof goJson.github_repo === "string" ? goJson.github_repo.trim() : "";
  const userUpdate: { profile_pic: string; github_repo?: string } = { profile_pic: githubPath };
  if (repoFromGo && validGitHubRepoName(repoFromGo)) {
    userUpdate.github_repo = repoFromGo;
  }

  const { error: updateError } = await db.from("users").update(userUpdate).eq("id", user.id);

  if (updateError) {
    return data({ success: false }, { status: 500 });
  }

  return data({ success: true, profile_pic: githubPath }, { status: 200 });
};
