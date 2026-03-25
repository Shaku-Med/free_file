import { useCallback, useEffect, useMemo, useRef } from "react";
import { data, useLoaderData, useLocation, type MetaFunction } from "react-router";
import { userProfileService, type UserProfile } from "~/lib/Services/UserProfileService";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import type { FileType } from "~/lib/types";
import UserProfileHeader from "./components/UserProfileHeader";
import UserFilesGrid from "./components/UserFilesGrid";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { BASE_URL } from "~/lib/URLS";
import { buildPageMeta, buildErrorMeta, SITE_NAME, THEME_COLOR } from "~/lib/seo";
import { usePageCache } from "~/lib/hooks/usePageCache";
import { useFileContext } from "~/lib/Context/Context";

interface ChannelStats {
  subscriber_count: number;
  subscription_count: number;
  is_subscribed: boolean;
  notify: boolean;
}

interface ProfileCachePayload {
  profile: UserProfile;
  files: FileType[];
  pagination: { page: number; limit: number; hasMore: boolean };
  userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  currentUserId: string | null;
  channelStats: ChannelStats;
}

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

    const user = await isAuthenticated(request, ['id']);
    const currentUserId = user?.id || null;

    const limit = 20;
    let files: FileType[] = [];
    let hasMore = false;
    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];

    if (db) {
      const { data: rows, error: rpcError } = await db.rpc('get_profile_files', {
        p_profile_user_id: profileResult.data.id,
        p_viewer_id: currentUserId,
        p_limit: limit + 1,  // fetch one extra to detect hasMore
        p_cursor_pos: 0,
      });

      if (!rpcError && Array.isArray(rows)) {
        hasMore = rows.length > limit;
        const sliced = rows.slice(0, limit);
        files = sliced.map((r: any) => {
          const fid = String(r.id);
          if (r.user_has_liked) likedFileIds.push(fid);
          if (r.user_has_disliked) dislikedFileIds.push(fid);
          return {
            ...r,
            like_count: Number(r.like_count) || 0,
            dislike_count: Number(r.dislike_count) || 0,
            comment_count: Number(r.comment_count) || 0,
            owner: r.owner_username ? {
              id: r.owner_id,
              username: r.owner_username,
              profile_pic: r.owner_profile_pic || '',
              verified: r.owner_verified || false,
              about: r.owner_about || null,
            } : null,
          } as FileType;
        });
      }
    }

    // Fetch channel stats (subscriber count, is_subscribed, notify)
    let channelStats: ChannelStats = { subscriber_count: 0, subscription_count: 0, is_subscribed: false, notify: false };
    if (db) {
      const { data: statsResult } = await db.rpc('get_channel_stats', {
        p_user_id: profileResult.data.id,
        p_viewer_id: currentUserId,
      });
      if (statsResult) {
        const parsed = typeof statsResult === 'string' ? JSON.parse(statsResult) : statsResult;
        channelStats = {
          subscriber_count: parsed.subscriber_count ?? 0,
          subscription_count: parsed.subscription_count ?? 0,
          is_subscribed: parsed.is_subscribed ?? false,
          notify: parsed.notify ?? false,
        };
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
        channelStats,
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

function blendFilesWithFresh(cachedFiles: FileType[], freshFiles: FileType[]): FileType[] {
  const freshById = new Map<string, FileType>();
  for (const f of freshFiles) {
    if (f.id) freshById.set(String(f.id), f);
  }

  const blended = cachedFiles.map(cached => {
    const fresh = cached.id ? freshById.get(String(cached.id)) : undefined;
    if (fresh) {
      freshById.delete(String(cached.id));
      return { ...cached, like_count: fresh.like_count, dislike_count: fresh.dislike_count, comment_count: fresh.comment_count, views: fresh.views, view_count: fresh.view_count, shares: fresh.shares, share_count: fresh.share_count };
    }
    return cached;
  });

  for (const fresh of freshById.values()) {
    const exists = blended.some(b => b.id && String(b.id) === String(fresh.id));
    if (!exists) blended.unshift(fresh);
  }

  return blended;
}

const Profile = () => {
  const loaderData = useLoaderData<typeof loader>();
  const location = useLocation();
  const pathname = location.pathname;
  const { getFromCache, addToCache } = usePageCache();
  const { setScrollDataReady } = useFileContext();
  const hasBlendedRef = useRef<string | null>(null);

  const cached = getFromCache(pathname);
  const cachedData = cached?.data as ProfileCachePayload | undefined;

  const loaderValid = !!(loaderData && loaderData.profile && !loaderData.error);
  const cacheValid = !!(cachedData?.profile && cachedData?.files?.length > 0);

  const effectiveData = useMemo((): ProfileCachePayload | null => {
    if (cacheValid && loaderValid && cachedData && loaderData) {
      const cachedPage = cachedData.pagination?.page ?? 1;

      const defaultStats: ChannelStats = { subscriber_count: 0, subscription_count: 0, is_subscribed: false, notify: false };

      if (cachedPage > 1) {
        const blendedFiles = blendFilesWithFresh(cachedData.files, loaderData.files ?? []);
        const freshLiked = new Set(loaderData.userActions?.likedFileIds ?? []);
        const freshDisliked = new Set(loaderData.userActions?.dislikedFileIds ?? []);
        const cachedLiked = new Set(cachedData.userActions?.likedFileIds ?? []);
        const cachedDisliked = new Set(cachedData.userActions?.dislikedFileIds ?? []);
        const mergedLiked = [...new Set([...cachedLiked, ...freshLiked])];
        const mergedDisliked = [...new Set([...cachedDisliked, ...freshDisliked])];

        return {
          profile: loaderData.profile,
          files: blendedFiles,
          pagination: cachedData.pagination,
          userActions: { likedFileIds: mergedLiked, dislikedFileIds: mergedDisliked },
          currentUserId: loaderData.currentUserId ?? cachedData.currentUserId,
          channelStats: loaderData.channelStats ?? cachedData.channelStats ?? defaultStats,
        };
      }

      return {
        profile: loaderData.profile,
        files: loaderData.files ?? [],
        pagination: loaderData.pagination ?? { page: 1, limit: 20, hasMore: false },
        userActions: {
          likedFileIds: loaderData.userActions?.likedFileIds ?? [],
          dislikedFileIds: loaderData.userActions?.dislikedFileIds ?? [],
        },
        currentUserId: loaderData.currentUserId ?? null,
        channelStats: loaderData.channelStats ?? defaultStats,
      };
    }

    if (cacheValid && cachedData) return cachedData;

    if (loaderValid && loaderData) {
      return {
        profile: loaderData.profile,
        files: loaderData.files ?? [],
        pagination: loaderData.pagination ?? { page: 1, limit: 20, hasMore: false },
        userActions: {
          likedFileIds: loaderData.userActions?.likedFileIds ?? [],
          dislikedFileIds: loaderData.userActions?.dislikedFileIds ?? [],
        },
        currentUserId: loaderData.currentUserId ?? null,
        channelStats: loaderData.channelStats ?? { subscriber_count: 0, subscription_count: 0, is_subscribed: false, notify: false },
      };
    }

    return null;
  }, [loaderValid, cacheValid, loaderData, cachedData]);

  useEffect(() => {
    if (!effectiveData) return;
    const cacheKey = `${pathname}:${effectiveData.pagination?.page ?? 1}`;
    if (hasBlendedRef.current === cacheKey) return;
    hasBlendedRef.current = cacheKey;

    addToCache(pathname, {
      data: effectiveData,
      currentPageNumber: effectiveData.pagination?.page ?? 1,
      nextPageNumber: (effectiveData.pagination?.page ?? 1) + 1,
      totalPages: 0,
      hasMore: effectiveData.pagination?.hasMore ?? false,
    });
  }, [pathname, effectiveData, addToCache]);

  useEffect(() => {
    if (effectiveData) setScrollDataReady(true);
    return () => setScrollDataReady(false);
  }, [effectiveData, setScrollDataReady]);

  const initialPage = cacheValid && cached ? cached.currentPageNumber : 1;

  const handleCacheUpdate = useCallback(
    (payload: { files: FileType[]; currentPage: number; hasMore: boolean }) => {
      if (!effectiveData) return;
      const updated: ProfileCachePayload = {
        ...effectiveData,
        files: payload.files,
        pagination: {
          ...effectiveData.pagination,
          page: payload.currentPage,
          hasMore: payload.hasMore,
        },
      };
      hasBlendedRef.current = `${pathname}:${payload.currentPage}`;
      addToCache(pathname, {
        data: updated,
        currentPageNumber: payload.currentPage,
        nextPageNumber: payload.currentPage + 1,
        totalPages: 0,
        hasMore: payload.hasMore,
      });
    },
    [pathname, effectiveData, addToCache]
  );

  if (!effectiveData) {
    if (loaderData && (loaderData.error || !loaderData.profile)) {
      const errorMessage = loaderData.error ?? "The user you're looking for doesn't exist.";
      return (
        <div className="flex items-center justify-center min-h-screen py-6 px-4">
          <div className="text-center space-y-4 max-w-md">
            <h1 className="text-2xl font-bold">User Not Found</h1>
            <p className="text-muted-foreground">{errorMessage}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const isOwner = effectiveData.currentUserId === effectiveData.profile.id;

  return (
    <div className="min-h-screen" data-data-ready={true}>
      <div className="max-w-6xl mx-auto">
        <UserProfileHeader
          profile={effectiveData.profile}
          isOwner={isOwner}
          currentUserId={effectiveData.currentUserId}
          channelStats={effectiveData.channelStats}
        />
        <UserFilesGrid
          files={effectiveData.files}
          userId={effectiveData.profile.id}
          currentUserId={effectiveData.currentUserId ?? undefined}
          initialHasMore={effectiveData.pagination?.hasMore}
          initialPage={initialPage}
          userActions={{
            likedFileIds: new Set(effectiveData.userActions.likedFileIds ?? []),
            dislikedFileIds: new Set(effectiveData.userActions.dislikedFileIds ?? []),
          }}
          onCacheUpdate={handleCacheUpdate}
          dataReady={true}
        />
      </div>
    </div>
  );
};

export default Profile;