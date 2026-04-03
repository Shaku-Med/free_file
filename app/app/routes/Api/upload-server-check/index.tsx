import { getAllKeys } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';
import { DecryptCombine } from '~/lib/Security/unsharedkeyEncryption/Combined/Combined';
import db from '~/lib/Database/supabase';

/**
 * GET /api/upload-server-check
 * Called by the Go upload server to verify the user. The Go server sends:
 *   Authorization: Bearer <c_user>
 * where c_user is the same encrypted token as the c_user cookie.
 * Returns 200 { userId, username } if valid, 401 if not.
 */
export const loader = async ({ request }: { request: Request }) => {
  try {
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const c_user = auth.slice(7).trim();
    if (!c_user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!db) {
      return new Response(JSON.stringify({ error: 'unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const keys = await getAllKeys(['token1', 'c_user']);
    if (!keys) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const decoded = await DecryptCombine(c_user, keys);
    if (!decoded || typeof decoded !== 'object' || !decoded.c_usr) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: user, error } = await db
      .from('users')
      .select('id, username')
      .eq('c_usr', decoded.c_usr)
      .maybeSingle();

    if (error || !user?.id) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        userId: user.id,
        username: typeof user.username === 'string' ? user.username : '',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
