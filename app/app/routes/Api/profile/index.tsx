import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "PATCH") {
      return data({ error: "Method not allowed" }, { status: 405 });
    }

    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    if (!db) {
      return data({ error: "Database not initialized" }, { status: 500 });
    }

    const body = await request.json();
    const { about } = body;

    if (about !== undefined) {
      if (typeof about !== "string") {
        return data({ error: "Bio must be a string" }, { status: 400 });
      }

      if (about.length > 500) {
        return data({ error: "Bio must be 500 characters or less" }, { status: 400 });
      }
    }

    const updateData: { about?: string } = {};
    if (about !== undefined) {
      updateData.about = about.trim() || null;
    }

    const { data: updatedUser, error } = await db
      .from('users')
      .update(updateData)
      .eq('id', user.id)
      .select('id, username, about')
      .single();

    if (error) {
      console.error('Error updating profile:', error);
      return data({ error: "Failed to update profile" }, { status: 500 });
    }

    return data({ success: true, user: updatedUser }, { status: 200 });
  } catch (error) {
    console.error("Error in profile action:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};

