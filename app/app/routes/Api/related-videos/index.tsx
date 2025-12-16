import { data } from "react-router";
import { getRandomVideos } from "~/routes/Dynamic/components/RelatedVideosService";
import { isAuthenticated } from "~/lib/Security/Password";
import { userActionsService } from "~/lib/Services/UserActionsService";

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const excludeId = url.searchParams.get("excludeId");
    const currentFileType = url.searchParams.get("fileType") || undefined;
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "10");

    if (!excludeId) {
      return data({ error: "excludeId is required", data: [] }, { status: 400 });
    }

    if (page < 1 || limit < 1 || limit > 50) {
      return data({ error: "Invalid pagination parameters", data: [] }, { status: 400 });
    }

    // Calculate offset
    const offset = (page - 1) * limit;
    
    // Fetch more videos than needed to account for filtering
    const fetchLimit = limit * 2;
    
    // Create a mock currentFile object if fileType is provided
    const currentFile = currentFileType ? { file_type: currentFileType } : undefined;

    // Fetch videos
    const videos = await getRandomVideos(request, excludeId, currentFile as any, fetchLimit);

    // Apply pagination
    const paginatedVideos = videos.slice(offset, offset + limit);
    const hasMore = videos.length > offset + limit;

    // Fetch user actions in one query
    const user = await isAuthenticated(request, ['id']);
    let userActions = { likedFileIds: [], dislikedFileIds: [] };
    if (user?.id && paginatedVideos.length > 0) {
      const fileIds = paginatedVideos.map(v => v.id).filter(Boolean);
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
        data: paginatedVideos,
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
    console.error("Error in related-videos loader:", error);
    return data({ error: "Internal server error", data: [] }, { status: 500 });
  }
};

