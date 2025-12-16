import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return data({ error: "User ID is required" }, { status: 400 });
    }

    // Verify the user is authenticated and requesting their own profile
    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id || user.id !== userId) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    if (!db) {
      return data({ error: "Database not initialized" }, { status: 500 });
    }

    const { data: userData, error } = await db
      .from('users')
      .select('id, username, profile_pic, about')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user profile:', error);
      return data({ error: "Failed to fetch user profile" }, { status: 500 });
    }

    if (!userData) {
      return data({ error: "User not found" }, { status: 404 });
    }

    return data(userData, { status: 200 });
  } catch (error) {
    console.error("Error in user-profile loader:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};

