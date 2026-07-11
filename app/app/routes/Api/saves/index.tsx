import { isAuthenticated } from '~/lib/Security/Password';
import db from '~/lib/Database/supabase';
import { isValidUUID } from '~/lib/Security/inputValidation';
import { filterFilesByAccess } from '~/routes/Api/fun/accessControl';
import { checkSavesGetRateLimit, checkSavesPostRateLimit } from '~/routes/Api/fun/personalizationRateLimit';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// GET: Check if a file is saved, or list all saved files
export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({}, 401);
    if (!db) return toJson({}, 500);

    const getLimit = checkSavesGetRateLimit(request, user.id);
    if (!getLimit.allowed) {
      return toJson({ error: getLimit.error ?? 'Rate limited' }, 429);
    }

    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');
    const list = url.searchParams.get('list');

    // List all saved files
    if (list === 'true') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
      const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

      const { data, error } = await db
        .from('saved_files')
        .select(`
          file_id,
          created_at,
          files:file_id (
            id, unique_id, file_title, file_description, file_type,
            default_thumbnail, view_count, share_count, is_reel, duration,
            categories, tags, owner_id, endpoint, filename, created_at,
            is_public, is_adult, upload_status
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('List saved files error:', error);
        return toJson({ error: 'Failed to list saved files' }, 500);
      }

      // A file may have been made private/age-gated after it was saved. Drop any
      // row the viewer can no longer access so we don't leak storage metadata
      // (endpoint/filename/owner) for content they're no longer allowed to see.
      const rows = Array.isArray(data) ? data : [];
      const accessibleFiles = await filterFilesByAccess(
        request,
        rows.map((r: any) => r.files).filter(Boolean) as any[],
      );
      const accessibleIds = new Set(accessibleFiles.map((f: any) => f?.id).filter(Boolean));
      const filtered = rows.filter((r: any) => r.files && accessibleIds.has(r.files.id));

      return toJson({ data: filtered, total: filtered.length });
    }

    // Check single file
    if (!fileId || !isValidUUID(fileId)) return toJson({ saved: false }, 200);

    const { data } = await db
      .from('saved_files')
      .select('file_id')
      .eq('user_id', user.id)
      .eq('file_id', fileId)
      .maybeSingle();

    return toJson({ saved: !!data }, 200);
  } catch {
    return toJson({ saved: false }, 200);
  }
};

// POST: Toggle save
export const action = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({}, 401);
    if (!db) return toJson({}, 500);

    const postLimit = checkSavesPostRateLimit(request, user.id);
    if (!postLimit.allowed) {
      return toJson({ error: postLimit.error ?? 'Rate limited' }, 429);
    }

    const body = await request.json();
    const fileId = body?.fileId;

    if (!fileId || !isValidUUID(fileId)) return toJson({ error: 'Invalid fileId' }, 400);

    const { data, error } = await db.rpc('toggle_save', {
      p_user_id: user.id,
      p_file_id: fileId,
    });

    if (error) {
      console.error('toggle_save error:', error);
      return toJson({ error: 'Failed to toggle save' }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return toJson({
      success: true,
      saved: row?.saved ?? false,
      save_count: Number(row?.save_count) ?? 0,
    });
  } catch (error) {
    console.error('Save action error:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
