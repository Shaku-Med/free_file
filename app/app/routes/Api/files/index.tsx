import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId, isValidUUID, sanitizeString } from "~/lib/Security/inputValidation";

const toJson = (body: unknown, status = 200) => data(body, { status });

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "PATCH") {
      return toJson({ error: "Method not allowed" }, 405);
    }

    const user = await isAuthenticated(request, ["id"]);
    if (!user || !user.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (!db) {
      return toJson({ error: "Database not initialized" }, 500);
    }

    const body = await request.json();
    const { fileId, title, description, isPublic, categories, tags } = body || {};

    if (!fileId || !isValidFileId(fileId)) {
      return toJson({ error: "Invalid fileId" }, 400);
    }

    const sanitizedTitle = title !== undefined ? sanitizeString(String(title), 200) : undefined;
    const sanitizedDescription = description !== undefined ? sanitizeString(String(description), 5000) : undefined;

    if (sanitizedTitle !== undefined && sanitizedTitle.length > 200) {
      return toJson({ error: "Title must be 200 characters or less" }, 400);
    }

    if (sanitizedDescription !== undefined && sanitizedDescription.length > 5000) {
      return toJson({ error: "Description must be 5000 characters or less" }, 400);
    }

    if (isPublic !== undefined && typeof isPublic !== "boolean") {
      return toJson({ error: "isPublic must be boolean" }, 400);
    }

    if (categories !== undefined && !Array.isArray(categories)) {
      return toJson({ error: "categories must be an array" }, 400);
    }

    if (tags !== undefined && !Array.isArray(tags)) {
      return toJson({ error: "tags must be an array" }, 400);
    }

    const lookupField = isValidUUID(fileId) ? "id" : "unique_id";
    const { data: fileRow, error: fetchError } = await db
      .from("files")
      .select("id, owner_id")
      .eq(lookupField, fileId)
      .single();

    if (fetchError || !fileRow) {
      return toJson({ error: "File not found" }, 404);
    }

    if (fileRow.owner_id !== user.id) {
      return toJson({ error: "Forbidden" }, 403);
    }

    const updateData: Record<string, any> = {};
    if (sanitizedTitle !== undefined) {
      updateData.file_title = sanitizedTitle.length > 0 ? sanitizedTitle : null;
    }
    if (sanitizedDescription !== undefined) {
      updateData.file_description = sanitizedDescription.length > 0 ? sanitizedDescription : null;
    }
    if (typeof isPublic === "boolean") {
      updateData.is_public = isPublic;
    }
    if (Array.isArray(categories)) {
      updateData.categories = categories
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.trim())
        .slice(0, 20);
    }
    if (Array.isArray(tags)) {
      updateData.tags = tags
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 50))
        .slice(0, 30);
    }

    if (Object.keys(updateData).length === 0) {
      return toJson({ error: "No changes provided" }, 400);
    }

    const { data: updatedFile, error: updateError } = await db
      .from("files")
      .update(updateData)
      .eq(lookupField, fileId)
      .select("id, file_title, file_description, is_public, categories, tags")
      .single();

    if (updateError) {
      console.error("Failed to update file:", updateError);
      return toJson({ error: updateError.message || "Failed to update file" }, 500);
    }

    return toJson({ success: true, file: updatedFile }, 200);
  } catch (error) {
    console.error("Error updating file:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
