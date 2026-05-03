import { isAuthenticated } from '~/lib/Security/Password';
import db from '~/lib/Database/supabase';
import { checkPersonalizationRateLimit } from '~/routes/Api/fun/personalizationRateLimit';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// POST: Refresh user's personalization data (interest profile + creator affinity)
// Called on login or periodically from the frontend
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ error: 'Unauthorized' }, 401);
    if (!db) return toJson({ error: 'Database not initialized' }, 500);

    const limit = checkPersonalizationRateLimit(request, user.id);
    if (!limit.allowed) {
      return toJson({ error: limit.error ?? 'Rate limited' }, 429);
    }

    const { error } = await db.rpc('refresh_user_personalization', {
      p_user_id: user.id,
    });

    if (error) {
      console.error('refresh_user_personalization error:', error);
      return toJson({ error: 'Failed to refresh personalization' }, 500);
    }

    return toJson({ success: true });
  } catch (error) {
    console.error('Personalization refresh error:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
