import { filterFilesByAccess } from '../fun/accessControl';
import { enrichFeedFilesWithInteractions } from '../fun/enrichFeedFiles';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';

const FEED_LIMIT = 20;

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const cursorPosParam = url.searchParams.get('cursor_pos');
    const cursorPos = cursorPosParam ? Math.max(0, parseInt(cursorPosParam, 10)) : 0;

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!db) {
      return new Response(JSON.stringify({ error: 'Database unavailable' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: feed, error } = await db.rpc('get_subscription_feed', {
      p_user_id: user.id,
      p_limit: FEED_LIMIT,
      p_cursor_pos: Number.isFinite(cursorPos) ? cursorPos : 0,
    });

    if (error) {
      console.error('get_subscription_feed RPC error:', error);
      return new Response(JSON.stringify({ error: 'Failed to fetch subscription feed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filteredFeed = await filterFilesByAccess(request, feed || []);

    const { data, likedFileIds, dislikedFileIds } = await enrichFeedFilesWithInteractions(
      db,
      filteredFeed as Record<string, unknown>[],
      user.id
    );

    const rawCount = (feed || []).length;
    const nextCursor =
      rawCount > 0 ? { cursor_pos: cursorPos + rawCount } : null;

    return new Response(
      JSON.stringify({
        data,
        userActions: { likedFileIds, dislikedFileIds },
        nextCursor,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Feed-Raw-Count': String(rawCount),
        },
      }
    );
  } catch (error) {
    console.error('Subscription feed error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
