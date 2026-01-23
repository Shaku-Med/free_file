import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { userProfileService } from "~/lib/Services/UserProfileService";
import { filterFilesByAccess } from "../fun/accessControl";
import { ownerService } from "~/lib/Services/OwnerService";
import { userActionsService } from "~/lib/Services/UserActionsService";

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

    const offset = (page - 1) * limit;
    const fetchMultiplier = 3;
    const fetchLimit = limit * fetchMultiplier;

    // Fetch files
    const filesResult = await userProfileService.getUserFiles(userId, fetchLimit, offset);

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
    let files = await filterFilesByAccess(request, filesWithDefaults);
    const paginatedFiles = files.slice(0, limit);
    const hasMore = files.length > limit;

    // Enrich with owner data
    files = await ownerService.enrichFilesWithOwners(paginatedFiles);

    // Fetch user actions in one query
    const user = await isAuthenticated(request, ['id']);
    let userActions: { likedFileIds: string[]; dislikedFileIds: string[] } = { likedFileIds: [], dislikedFileIds: [] };
    if (user?.id && files.length > 0) {
      const fileIds = files.map(f => f.id).filter(Boolean);
      if (fileIds.length > 0) {
        const actions = await userActionsService.getUserActions(user.id, fileIds);
        userActions = {
          likedFileIds: Array.from(actions.likedFileIds),
          dislikedFileIds: Array.from(actions.dislikedFileIds)
        };
      }
    }

    return data(
      {
        data: files,
        userActions,
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

