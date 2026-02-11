import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const fileIds = body.fileIds;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return new Response(JSON.stringify({ error: 'fileIds required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validIds = fileIds
      .filter((id: any) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
      .slice(0, 500);

    if (validIds.length === 0) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.rpc('mark_feed_seen', {
      p_user_id: user.id,
      p_file_ids: validIds
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Mark seen error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
