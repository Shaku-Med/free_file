import { data, useLoaderData, type MetaFunction } from "react-router";
import { userProfileService } from "~/lib/Services/UserProfileService";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { isAuthenticated } from "~/lib/Security/Password";
import { ownerService } from "~/lib/Services/OwnerService";
import { userActionsService } from "~/lib/Services/UserActionsService";
import type { FileType } from "~/lib/types";
import UserProfileHeader from "./components/UserProfileHeader";
import UserFilesGrid from "./components/UserFilesGrid";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { BASE_URL } from "~/lib/URLS";

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

    const url = new URL(request.url);
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
        },
        pageUrl: url.pathname
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

export const meta: MetaFunction<ReturnType<typeof loader>> = ({ data, location }: { data: any; location?: any }) => {
  try {
    if (!data || !data.profile) {
      return [
        {
          title: "User Not Found - Memories",
        },
        {
          name: "description",
          content: "The user profile you're looking for doesn't exist on Memories",
        },
        { name: "robots", content: "noindex, nofollow" },
      ];
    }

    const profile = data.profile;
    const username = profile.username || 'User';
    const about = profile.about || '';
    const fileCount = profile.file_count || 0;
    const createdAt = profile.created_at ? new Date(profile.created_at).toISOString() : null;
    
    const profilePicUrl = profile.profile_pic 
      ? (() => {
          const picUrl = getProfilePicUrl(profile.profile_pic);
          if (!picUrl) return null;
          const absoluteUrl = picUrl.startsWith('http') ? picUrl : `${BASE_URL}${picUrl.startsWith('/') ? '' : '/'}${picUrl}`;
          return absoluteUrl;
        })()
      : null;

    const pageUrl = `${BASE_URL}${data?.pageUrl || `/profile/${username}`}`;
    
    const baseDescription = about 
      ? about.substring(0, 150)
      : `View ${username}'s profile on Memories`;
    
    const statsText = fileCount > 0 ? ` • ${fileCount} ${fileCount === 1 ? 'upload' : 'uploads'}` : '';
    const description = `${baseDescription}${statsText}`.substring(0, 200);

    const title = `${username} - Profile | Memories`.substring(0, 60);

    const keywords = [
      username,
      'memories',
      'profile',
      'user profile',
      'social media',
      'content sharing',
      'memories app',
      'share memories',
      ...(about ? about.split(' ').filter((w: string) => w.length > 3).slice(0, 5) : [])
    ].join(', ');

    return [
      {
        title,
      },
      {
        name: "description",
        content: description,
      },
      {
        name: "keywords",
        content: keywords,
      },
      {
        name: "author",
        content: username,
      },
      {
        name: "canonical",
        content: pageUrl,
      },
      {
        name: "robots",
        content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      },
      {
        name: "googlebot",
        content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      },
      {
        property: "og:type",
        content: "profile",
      },
      {
        property: "og:title",
        content: title,
      },
      {
        property: "og:description",
        content: description,
      },
      ...(profilePicUrl ? [
        {
          property: "og:image",
          content: profilePicUrl,
        },
        {
          property: "og:image:secure_url",
          content: profilePicUrl,
        },
        {
          property: "og:image:alt",
          content: `${username}'s profile picture on Memories`,
        },
        {
          property: "og:image:type",
          content: "image/jpeg",
        },
        {
          property: "og:image:width",
          content: "1200",
        },
        {
          property: "og:image:height",
          content: "1200",
        },
      ] : []),
      {
        property: "og:url",
        content: pageUrl,
      },
      {
        property: "og:site_name",
        content: "Memories",
      },
      {
        property: "og:locale",
        content: "en_US",
      },
      {
        property: "og:locale:alternate",
        content: "en_US",
      },
      {
        property: "profile:username",
        content: username,
      },
      {
        property: "profile:first_name",
        content: username,
      },
      ...(createdAt ? [
        {
          property: "profile:created_time",
          content: createdAt,
        },
      ] : []),
      {
        name: "twitter:card",
        content: profilePicUrl ? "summary_large_image" : "summary",
      },
      {
        name: "twitter:title",
        content: title,
      },
      {
        name: "twitter:description",
        content: description,
      },
      {
        name: "twitter:site",
        content: "@Memories",
      },
      {
        name: "twitter:creator",
        content: `@${username}`,
      },
      ...(profilePicUrl ? [
        {
          name: "twitter:image",
          content: profilePicUrl,
        },
        {
          name: "twitter:image:alt",
          content: `${username}'s profile picture`,
        },
        {
          name: "twitter:image:src",
          content: profilePicUrl,
        },
      ] : []),
      {
        name: "application-name",
        content: "Memories",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "Memories",
      },
      {
        name: "theme-color",
        content: "#000000",
      },
      {
        rel: "preconnect",
        href: BASE_URL,
        as: "document",
      },
      {
        rel: "dns-prefetch",
        href: BASE_URL,
      },
      ...(profilePicUrl ? (() => {
        try {
          const urlOrigin = new URL(profilePicUrl).origin;
          return [
            {
              rel: "preconnect",
              href: urlOrigin,
              as: "image",
            },
            {
              rel: "dns-prefetch",
              href: urlOrigin,
            },
          ];
        } catch {
          return [];
        }
      })() : []),
    ];
  } catch (error) {
    console.error('Error in profile meta:', error);
    return [
      {
        title: "Profile - Memories",
      },
    ];
  }
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

