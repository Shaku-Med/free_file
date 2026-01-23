import { data, useLoaderData, type MetaFunction } from "react-router";
import { userProfileService } from "~/lib/Services/UserProfileService";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { isAuthenticated } from "~/lib/Security/Password";
import { ownerService } from "~/lib/Services/OwnerService";
import { userActionsService } from "~/lib/Services/UserActionsService";
import type { FileType } from "~/lib/types";
import UserProfileHeader from "./components/UserProfileHeader";
import UserFilesGrid from "./components/UserFilesGrid";

export const loader = async ({ request, params }: { request: Request; params: { username: string } }) => {
  try {
    const { username } = params;

    if (!username) {
      return data({ profile: null, files: [], error: "Username is required", currentUserId: null }, { status: 400 });
    }

    const profileResult = await userProfileService.getUserProfileByUsername(username);

    if (profileResult.error || !profileResult.data) {
      return data(
        { profile: null, files: [], error: profileResult.error || "User not found", currentUserId: null },
        { status: 404 }
      );
    }

    // Get current user for access control
    const user = await isAuthenticated(request, ['id']);
    const currentUserId = user?.id || null;

    // Fetch initial files with overfetch to account for filtering
    const limit = 20;
    const fetchMultiplier = 3;
    const fetchLimit = limit * fetchMultiplier;
    const filesResult = await userProfileService.getUserFiles(profileResult.data.id, fetchLimit, 0);

    let files: FileType[] = [];
    let hasMore = false;
    if (filesResult.data) {
      const filesWithDefaults = filesResult.data.map(file => ({
        ...file,
        is_adult: file.is_adult ?? false,
        is_public: file.is_public ?? true,
        upload_status: file.upload_status ?? 'completed',
        owner_id: file.owner_id ?? ''
      }));
      const filteredFiles = await filterFilesByAccess(request, filesWithDefaults);
      files = filteredFiles.slice(0, limit);
      hasMore = filteredFiles.length > limit;
      // Enrich with owner data
      files = await ownerService.enrichFilesWithOwners(files);
    }

    // Fetch user actions in one query
    let userActions = { likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() };
    if (currentUserId && files.length > 0) {
      const fileIds = files.map(f => f.id).filter(Boolean);
      if (fileIds.length > 0) {
        userActions = await userActionsService.getUserActions(currentUserId, fileIds);
      }
    }

    return data(
      {
        profile: profileResult.data,
        files: files,
        pagination: {
          page: 1,
          limit,
          hasMore
        },
        error: null,
        currentUserId,
        userActions: {
          likedFileIds: Array.from(userActions.likedFileIds),
          dislikedFileIds: Array.from(userActions.dislikedFileIds)
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in profile loader:", error);
    return data(
      { profile: null, files: [], error: "Internal server error", currentUserId: null },
      { status: 500 }
    );
  }
};

export const meta: MetaFunction<ReturnType<typeof loader>> = ({ data }: { data: any }) => {
  if (!data || !data.profile) {
    return [
      {
        title: "User Not Found - Memories",
      },
    ];
  }

  return [
    {
      title: `${data.profile.username} - Memories`,
    },
    {
      name: "description",
      content: `View ${data.profile.username}'s profile and uploaded content on Memories`,
    },
  ];
};

const Profile = () => {
  const loaderData = useLoaderData<typeof loader>();

  if (loaderData.error || !loaderData.profile) {
    return (
      <div className="flex items-center justify-center min-h-screen py-6 px-4">
        <div className="text-center space-y-4 max-w-md">
          <h1 className="text-2xl font-bold">User Not Found</h1>
          <p className="text-muted-foreground">
            {loaderData.error || "The user you're looking for doesn't exist."}
          </p>
        </div>
      </div>
    );
  }

  const isOwner = loaderData.currentUserId === loaderData.profile.id;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <UserProfileHeader profile={loaderData.profile} isOwner={isOwner} />
        <UserFilesGrid 
          files={loaderData.files} 
          userId={loaderData.profile.id}
          currentUserId={loaderData.currentUserId || undefined}
          initialHasMore={loaderData.pagination?.hasMore}
          userActions={loaderData.userActions ? {
            likedFileIds: new Set(loaderData.userActions.likedFileIds || []),
            dislikedFileIds: new Set(loaderData.userActions.dislikedFileIds || [])
          } : undefined}
        />
      </div>
    </div>
  );
};

export default Profile;

