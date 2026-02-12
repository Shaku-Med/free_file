import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { userProfileService } from "~/lib/Services/UserProfileService";
import { filterFilesByAccess } from "../fun/accessControl";
import { ownerService } from "~/lib/Services/OwnerService";
import db from "~/lib/Database/supabase";

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");

    if (!userId) {
      return data({ error: "User ID is required" }, { status: 400 });
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return data({ error: "Invalid pagination parameters" }, { status: 400 });
    }

    // Fetch a larger batch to account for files that might be filtered out
    // We fetch 3x the limit to ensure we have enough after filtering
    const fetchMultiplier = 3;
    const fetchLimit = limit * fetchMultiplier;
    
    // Calculate the database offset. Since we filter after fetching, we need to
    // fetch from an earlier offset to account for filtered files.
    // For page 1: offset 0
    // For page 2+: we start from a position that accounts for potential filtered files
    // Using a simple multiplier approach - fetch from (page-1) * limit * 2 to be safe
    const dbOffset = page === 1 ? 0 : (page - 1) * limit * 2;

    // Fetch files from database
    const filesResult = await userProfileService.getUserFiles(userId, fetchLimit, dbOffset);

    if (filesResult.error || !filesResult.data) {
      return data({ error: filesResult.error || "Failed to fetch files", data: [] }, { status: 500 });
    }

    // Filter by access control
    const filesWithDefaults = filesResult.data.map(file => ({
      ...file,
      is_adult: file.is_adult ?? false,
      is_public: file.is_public ?? true,
      upload_status: file.upload_status ?? 'completed',
      owner_id: file.owner_id ?? ''
    }));
    let filteredFiles = await filterFilesByAccess(request, filesWithDefaults);
    
    // For page 1, take the first 'limit' files
    // For subsequent pages, we need to account for files that might have been
    // shown on previous pages. Since we're fetching from dbOffset, we take
    // files starting from position 0 in the filtered results (they're already
    // offset correctly from the database query)
    const paginatedFiles = filteredFiles.slice(0, limit);
    const hasMore = filteredFiles.length > limit;

    // Enrich with owner data
    let enrichedFiles = await ownerService.enrichFilesWithOwners(paginatedFiles);

    // Live like/dislike/comment counts and user liked state from get_batch_interactions
    const user = await isAuthenticated(request, ['id']);
    const currentUserId = user?.id ?? null;
    const fileIds = enrichedFiles.map(f => f.id).filter(Boolean);
    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];
    if (fileIds.length > 0 && db) {
      const { data: batch } = await db.rpc('get_batch_interactions', {
        p_file_ids: fileIds,
        p_user_id: currentUserId,
      });
      if (Array.isArray(batch)) {
        const interactionsByFile = new Map<string, { like_count: number; dislike_count: number; comment_count: number; user_has_liked: boolean; user_has_disliked: boolean }>();
        for (const row of batch) {
          if (row?.file_id) {
            const fid = String(row.file_id);
            interactionsByFile.set(fid, {
              like_count: Number(row.like_count) ?? 0,
              dislike_count: Number(row.dislike_count) ?? 0,
              comment_count: Number(row.comment_count) ?? 0,
              user_has_liked: !!row.user_has_liked,
              user_has_disliked: !!row.user_has_disliked,
            });
            if (row.user_has_liked) likedFileIds.push(fid);
            if (row.user_has_disliked) dislikedFileIds.push(fid);
          }
        }
        enrichedFiles = enrichedFiles.map(f => {
          const ix = f.id ? interactionsByFile.get(String(f.id)) : undefined;
          if (!ix) return { ...f, like_count: 0, dislike_count: 0, comment_count: 0 };
          return { ...f, like_count: ix.like_count, dislike_count: ix.dislike_count, comment_count: ix.comment_count };
        });
      }
    }

    return data(
      {
        data: enrichedFiles,
        userActions: { likedFileIds, dislikedFileIds },
        pagination: {
          page,
          limit,
          hasMore,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in user-files loader:", error);
    return data({ error: "Internal server error", data: [] }, { status: 500 });
  }
};

