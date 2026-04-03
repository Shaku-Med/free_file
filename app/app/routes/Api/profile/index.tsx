import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { textContainsNsfw } from "~/lib/nsfwTextCheck";
import { GitHubClient } from "~/lib/Github/GitHubClient";
import { config } from "~/lib/config";
import { deleteOldProfilePicIfNeeded, githubRepoForProfile } from "~/lib/profilePicGithub.server";

function profilePicPathBelongsToUser(path: string, username: string, userId: string): boolean {
  if (!path || path.length > 200 || path.includes("..") || path.includes("\\")) return false;
  const parts = path.split("/");
  if (parts.length !== 2 || parts[0] !== username) return false;
  const file = parts[1];
  const prefix = `${userId}.`;
  if (!file.startsWith(prefix)) return false;
  const ext = file.slice(userId.length).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "PATCH") {
      return data({ error: "Method not allowed" }, { status: 405 });
    }

    const user = await isAuthenticated(request, ["id", "username"]);
    if (!user || !user.id || !user.username) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    if (!db) {
      return data({ error: "Database not initialized" }, { status: 500 });
    }

    const body = await request.json();
    const { about, profile_pic } = body;

    if (about === undefined && profile_pic === undefined) {
      return data({ error: "No updates provided" }, { status: 400 });
    }

    if (about !== undefined) {
      if (typeof about !== "string") {
        return data({ error: "Bio must be a string" }, { status: 400 });
      }

      if (about.length > 500) {
        return data({ error: "Bio must be 500 characters or less" }, { status: 400 });
      }

      const trimmedAbout = about.trim();
      if (trimmedAbout && textContainsNsfw(trimmedAbout)) {
        return data(
          { error: "Bio contains language that is not allowed on your profile." },
          { status: 422 },
        );
      }
    }

    if (profile_pic !== undefined) {
      if (typeof profile_pic !== "string" || !profile_pic.trim()) {
        return data({ error: "Invalid profile picture path" }, { status: 400 });
      }
      const trimmedPath = profile_pic.trim();
      if (!profilePicPathBelongsToUser(trimmedPath, user.username, user.id)) {
        return data({ error: "Invalid profile picture path" }, { status: 400 });
      }
    }

    const updateData: { about?: string | null; profile_pic?: string } = {};
    if (about !== undefined) {
      updateData.about = about.trim() || null;
    }
    if (profile_pic !== undefined) {
      updateData.profile_pic = profile_pic.trim();
    }

    if (profile_pic !== undefined && config.github.token && config.github.owner) {
      const { data: row } = await db
        .from("users")
        .select("profile_pic")
        .eq("id", user.id)
        .maybeSingle();
      const ghRepo = githubRepoForProfile();
      const githubClient = new GitHubClient(config.github.token, config.github.owner, ghRepo);
      try {
        await deleteOldProfilePicIfNeeded(
          githubClient,
          row?.profile_pic,
          profile_pic.trim(),
          user.username,
        );
      } catch (e) {
        console.warn("[profile] old profile pic cleanup:", e);
      }
    }

    const { data: updatedUser, error } = await db
      .from("users")
      .update(updateData)
      .eq("id", user.id)
      .select("id, username, about, profile_pic")
      .single();

    if (error) {
      console.error("Error updating profile:", error);
      return data({ error: "Failed to update profile" }, { status: 500 });
    }

    return data({ success: true, user: updatedUser }, { status: 200 });
  } catch (error) {
    console.error("Error in profile action:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};

