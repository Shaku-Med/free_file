import { isAuthenticated } from '~/lib/Security/Password';
import db from '~/lib/Database/supabase';
import { isValidUUID, sanitizeString } from '~/lib/Security/inputValidation';
import { checkFeedSignalsGetRateLimit, checkFeedSignalsPostRateLimit } from '~/routes/Api/fun/personalizationRateLimit';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const VALID_SIGNAL_TYPES = ['not_interested', 'hide_creator', 'hide_category'] as const;
type ValidSignalType = (typeof VALID_SIGNAL_TYPES)[number];

function isValidSignalType(value: unknown): value is ValidSignalType {
  return typeof value === 'string' && (VALID_SIGNAL_TYPES as readonly string[]).includes(value);
}

/** Category labels only — keeps storage bounded and aligned with feed SQL. */
const MAX_CATEGORY_LEN = 128;

// POST: Add a negative signal (not interested, hide creator, hide category)
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);

    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ error: 'Unauthorized' }, 401);
    if (!db) return toJson({ error: 'Database not initialized' }, 500);

    const postLimit = checkFeedSignalsPostRateLimit(request, user.id);
    if (!postLimit.allowed) {
      return toJson({ error: postLimit.error ?? 'Rate limited' }, 429);
    }

    const body = await request.json();
    const { signalType, fileId, creatorId, category } = body;

    if (!isValidSignalType(signalType)) {
      return toJson({ error: 'Invalid signalType. Must be: not_interested, hide_creator, or hide_category' }, 400);
    }

    // Validate based on signal type
    if (signalType === 'not_interested' && (!fileId || !isValidUUID(fileId))) {
      return toJson({ error: 'fileId required for not_interested signal' }, 400);
    }
    if (signalType === 'hide_creator' && (!creatorId || !isValidUUID(creatorId))) {
      return toJson({ error: 'creatorId required for hide_creator signal' }, 400);
    }
    let categorySafe: string | null = null;
    if (signalType === 'hide_category') {
      if (category == null || typeof category !== 'string') {
        return toJson({ error: 'category required for hide_category signal' }, 400);
      }
      categorySafe = sanitizeString(category, MAX_CATEGORY_LEN);
      if (!categorySafe) {
        return toJson({ error: 'Invalid category' }, 400);
      }
    }

    const { error } = await db.rpc('add_negative_signal', {
      p_user_id: user.id,
      p_signal_type: signalType,
      p_file_id: fileId || null,
      p_creator_id: creatorId || null,
      p_category: categorySafe,
    });

    if (error) {
      console.error('add_negative_signal error:', error);
      return toJson({ error: 'Failed to add signal' }, 500);
    }

    return toJson({ success: true });
  } catch (error) {
    console.error('Feed signal action error:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};

// GET: List user's negative signals (for settings page)
export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user?.id || !db) return toJson({ data: [] }, 200);

    const getLimit = checkFeedSignalsGetRateLimit(request, user.id);
    if (!getLimit.allowed) {
      return toJson({ error: getLimit.error ?? 'Rate limited' }, 429);
    }

    const url = new URL(request.url);
    const signalType = url.searchParams.get('type');

    let query = db
      .from('feed_negative_signals')
      .select('id, file_id, creator_id, category, signal_type, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (signalType && isValidSignalType(signalType)) {
      query = query.eq('signal_type', signalType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('List negative signals error:', error);
      return toJson({ error: 'Failed to list signals' }, 500);
    }

    return toJson({ data: data || [] });
  } catch {
    return toJson({ data: [] }, 200);
  }
};
