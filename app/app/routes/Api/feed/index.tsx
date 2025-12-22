import { VerifyToken } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken';
import { getCookie } from '~/lib/Security/Token';
import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { ownerService } from '~/lib/Services/OwnerService';
import { userActionsService } from '~/lib/Services/UserActionsService';
import { isAuthenticated } from '~/lib/Security/Password';

const FEED_LIMIT = 20;

async function getLikedFileIds(userId: string): Promise<string[]> {
  const { data } = await db
    .from('likes')
    .select('file_id')
    .eq('user_id', userId)
    .limit(500);

  return data?.map((l: any) => l.file_id) || [];
}

async function getDislikedFileIds(userId: string): Promise<string[]> {
  const { data } = await db
    .from('dislike')
    .select('file_id')
    .eq('user_id', userId)
    .limit(500);

  return data?.map((d: any) => d.file_id) || [];
}

async function getUserPreferredCategories(userId: string): Promise<string[]> {
  const { data: likedCategories } = await db
    .from('likes')
    .select('files!inner(category)')
    .eq('user_id', userId)
    .limit(100);

  const { data: commentedCategories } = await db
    .from('comments')
    .select('files!inner(category)')
    .eq('user_id', userId)
    .limit(50);

  const categoryCounts = new Map<string, number>();

  const processCategories = (items: any[], weight: number) => {
    items?.forEach((item: any) => {
      if (item.files?.category && Array.isArray(item.files.category)) {
        item.files.category.forEach((cat: any) => {
          if (cat?.name) {
            categoryCounts.set(cat.name, (categoryCounts.get(cat.name) || 0) + weight);
          }
        });
      }
    });
  };

  processCategories(likedCategories || [], 2);
  processCategories(commentedCategories || [], 1);

  return Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);
}

async function getForYouFileIds(userId: string, likedIds: string[]): Promise<string[]> {
  if (likedIds.length === 0) return [];

  const { data: similarUsers } = await db
    .from('likes')
    .select('user_id')
    .in('file_id', likedIds.slice(0, 50))
    .neq('user_id', userId)
    .limit(100);

  if (!similarUsers || similarUsers.length === 0) return [];

  const userCounts = new Map<string, number>();
  similarUsers.forEach((item: any) => {
    userCounts.set(item.user_id, (userCounts.get(item.user_id) || 0) + 1);
  });

  const topSimilarUsers = Array.from(userCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id]) => id);

  const { data } = await db
    .from('likes')
    .select('file_id')
    .in('user_id', topSimilarUsers)
    .limit(200);

  if (!data) return [];

  const fileCounts = new Map<string, number>();
  data.forEach((item: any) => {
    fileCounts.set(item.file_id, (fileCounts.get(item.file_id) || 0) + 1);
  });

  return Array.from(fileCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([id]) => id);
}

function parseSeenIds(seenParam: string | null): string[] {
  if (!seenParam) return [];
  
  try {
    const parsed = JSON.parse(seenParam);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((id: any) => typeof id === 'string' && id.length > 0)
        .slice(0, 500);
    }
  } catch {
    return seenParam
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .slice(0, 500);
  }
  
  return [];
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const seenParam = url.searchParams.get('seen');
    const seenIds = parseSeenIds(seenParam);

    let userId: string | undefined;
    const token = getCookie('token', request.headers);

    if (token) {
      const decoded = await VerifyToken({
        token,
        addedKeyNames: ['token1', 'token2']
      }, request.headers);

      if (decoded) {
        const user = await isAuthenticated(request, ['id']);
        userId = user?.id;
      }
    }

    let likedIds: string[] = [];
    let dislikedIds: string[] = [];
    let preferredCategories: string[] = [];
    let forYouIds: string[] = [];

    if (userId) {
      [likedIds, dislikedIds, preferredCategories] = await Promise.all([
        getLikedFileIds(userId),
        getDislikedFileIds(userId),
        getUserPreferredCategories(userId)
      ]);

      forYouIds = await getForYouFileIds(userId, likedIds);
    }

    const { data: feed, error } = await db.rpc('get_feed', {
      p_user_id: userId || null,
      p_limit: FEED_LIMIT,
      p_seen_ids: seenIds,
      p_liked_ids: likedIds,
      p_disliked_ids: dislikedIds,
      p_preferred_categories: preferredCategories,
      p_foryou_ids: forYouIds
    });

    if (error) {
      console.error('Feed RPC error:', error);
      return new Response(JSON.stringify({ error: 'Failed to fetch feed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const filteredFeed = await filterFilesByAccess(request, feed || []);
    const filesWithOwners = await ownerService.enrichFilesWithOwners(filteredFeed);

    let userActions: { likedFileIds: string[]; dislikedFileIds: string[] } = { likedFileIds: [], dislikedFileIds: [] };
    if (userId && filesWithOwners.length > 0) {
      const fileIds = filesWithOwners.map((f: any) => f.id).filter(Boolean);
      if (fileIds.length > 0) {
        const actions = await userActionsService.getUserActions(userId, fileIds);
        userActions = {
          likedFileIds: Array.from(actions.likedFileIds),
          dislikedFileIds: Array.from(actions.dislikedFileIds)
        };
      }
    }

    const result = {
      data: filesWithOwners.map((file: any) => {
        const { feed_reason, ...rest } = file;
        return {
          ...rest,
          feedMeta: { reason: feed_reason }
        };
      }),
      userActions
    };

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('Feed error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};