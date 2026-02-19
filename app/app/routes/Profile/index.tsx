import { data, useLoaderData, type MetaFunction } from "react-router";
import { userProfileService } from "~/lib/Services/UserProfileService";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { isAuthenticated } from "~/lib/Security/Password";
import { ownerService } from "~/lib/Services/OwnerService";
import db from "~/lib/Database/supabase";
import type { FileType } from "~/lib/types";
import UserProfileHeader from "./components/UserProfileHeader";
import UserFilesGrid from "./components/UserFilesGrid";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { BASE_URL } from "~/lib/URLS";
import { buildPageMeta, buildErrorMeta, SITE_NAME, THEME_COLOR } from "~/lib/seo";

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

    // Live like/dislike/comment counts and user liked state from get_batch_interactions
    const fileIds = files.map(f => f.id).filter(Boolean);
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
        files = files.map(f => {
          const ix = f.id ? interactionsByFile.get(String(f.id)) : undefined;
          if (!ix) return f;
          return { ...f, like_count: ix.like_count, dislike_count: ix.dislike_count, comment_count: ix.comment_count };
        });
      }
    }

    const url = new URL(request.url);
    return data(
      {
        profile: profileResult.data,
        files,
        pagination: {
          page: 1,
          limit,
          hasMore
        },
        error: null,
        currentUserId,
        userActions: {
          likedFileIds,
          dislikedFileIds
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

export const meta: MetaFunction<ReturnType<typeof loader>> = ({ data }: { data: any }) => {
  try {
    if (!data || !data.profile) {
      return buildPageMeta({
        title: "User Not Found | Memories",
        description: "The user profile you're looking for doesn't exist on Memories",
        canonicalPath: data?.pageUrl ?? "/profile",
        noindex: true,
      });
    }

    const profile = data.profile;
    const username = profile.username || "User";
    const about = profile.about || "";
    const fileCount = profile.file_count || 0;
    const createdAt = profile.created_at ? new Date(profile.created_at).toISOString() : null;

    const profilePicUrl = profile.profile_pic
      ? (() => {
          const picUrl = getProfilePicUrl(profile.profile_pic);
          if (!picUrl) return undefined;
          return picUrl.startsWith("http") ? picUrl : `${BASE_URL}${picUrl.startsWith("/") ? "" : "/"}${picUrl}`;
        })()
      : undefined;

    const baseDescription = about ? about.substring(0, 150) : `View ${username}'s profile on Memories`;
    const statsText = fileCount > 0 ? ` • ${fileCount} ${fileCount === 1 ? "upload" : "uploads"}` : "";
    const description = `${baseDescription}${statsText}`.substring(0, 200);
    const title = `${username} - Profile | Memories`.substring(0, 60);
    const keywords = [
      username,
      "memories",
      "profile",
      "user profile",
      "social media",
      "content sharing",
      "memories app",
      "share memories",
      ...(about ? about.split(" ").filter((w: string) => w.length > 3).slice(0, 5) : []),
    ].join(", ");

    const extra: import("react-router").MetaDescriptor[] = [
      ...(profilePicUrl
        ? [
            { property: "og:image:secure_url", content: profilePicUrl },
            { property: "og:image:type", content: "image/jpeg" },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "1200" },
          ]
        : []),
      { property: "profile:username", content: username },
      { property: "profile:first_name", content: username },
      ...(createdAt ? [{ property: "profile:created_time", content: createdAt }] : []),
      { name: "twitter:card", content: profilePicUrl ? "summary_large_image" : "summary" },
      { name: "twitter:site", content: "@Memories" },
      { name: "twitter:creator", content: `@${username}` },
      ...(profilePicUrl
        ? [
            { name: "twitter:image", content: profilePicUrl },
            { name: "twitter:image:alt", content: `${username}'s profile picture` },
          ]
        : []),
      { name: "application-name", content: SITE_NAME },
      { name: "apple-mobile-web-app-title", content: SITE_NAME },
      { name: "theme-color", content: THEME_COLOR },
      { rel: "preconnect", href: BASE_URL, as: "document" },
      { rel: "dns-prefetch", href: BASE_URL },
    ];

    if (profilePicUrl) {
      try {
        const urlOrigin = new URL(profilePicUrl).origin;
        extra.push({ rel: "preconnect", href: urlOrigin, as: "image" });
        extra.push({ rel: "dns-prefetch", href: urlOrigin });
      } catch {}
    }

    return buildPageMeta({
      title,
      description,
      canonicalPath: data?.pageUrl ?? `/profile/${username}`,
      ogImage: profilePicUrl,
      ogImageAlt: `${username}'s profile picture on Memories`,
      keywords,
      author: username,
      ogType: "profile",
      extra,
    });
  } catch {
    return buildPageMeta({
      title: "Profile | Memories",
      description: "User profile on Memories",
      noindex: true,
    });
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

