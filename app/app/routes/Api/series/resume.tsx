import db from '~/lib/Database/supabase';
import { isValidFileId, isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * GET /api/series/resume?seriesId=<file_series_id>&seriesUniqueId=<series_cover_unique_id>
 *
 * Returns the most recently watched file in the given series for the signed-in viewer
 * (used by the series-main video card so a click jumps straight to "continue watching").
 * Guests / never-watched series → `{ resume: null }` and the caller falls back to the
 * series main file's normal navigation.
 */
export const loader = async ({ request }: { request: Request }) => {
  if (request.method !== 'GET') return toJson({ error: 'Method not allowed' }, 405);
  if (!db) return toJson({ resume: null }, 200);

  const user = await isAuthenticated(request, ['id']);
  if (!user?.id) return toJson({ resume: null }, 200);

  const url = new URL(request.url);
  const seriesIdRaw = url.searchParams.get('seriesId')?.trim();
  const seriesUniqueIdRaw = url.searchParams.get('seriesUniqueId')?.trim();
  const seriesFileIdRaw = url.searchParams.get('seriesFileId')?.trim();

  const seriesId = seriesIdRaw && isValidUUID(seriesIdRaw) ? seriesIdRaw : null;
  const seriesUniqueId =
    seriesUniqueIdRaw && isValidFileId(seriesUniqueIdRaw) ? seriesUniqueIdRaw : null;
  const seriesFileId = seriesFileIdRaw && isValidUUID(seriesFileIdRaw) ? seriesFileIdRaw : null;

  if (!seriesId && !seriesUniqueId && !seriesFileId) {
    return toJson({ error: 'Invalid series identifier' }, 400);
  }

  let resolvedSeriesId = seriesId;
  if (!resolvedSeriesId) {
    let resolveQuery = db.from('files').select('file_series_id').limit(1);
    if (seriesUniqueId) resolveQuery = resolveQuery.eq('unique_id', seriesUniqueId);
    else resolveQuery = resolveQuery.eq('id', seriesFileId as string);
    const { data: resolvedFile, error: resolveError } = await resolveQuery.maybeSingle();
    if (resolveError) {
      console.error('series-resume resolve series id:', resolveError);
      return toJson({ resume: null }, 200);
    }
    const candidate = resolvedFile?.file_series_id;
    resolvedSeriesId = typeof candidate === 'string' && isValidUUID(candidate) ? candidate : null;
  }

  if (!resolvedSeriesId) {
    return toJson({ resume: null }, 200);
  }

  const { data, error } = await db.rpc('get_series_resume', {
    p_user_id: user.id,
    p_file_series_id: resolvedSeriesId,
  });

  if (error) {
    console.error('get_series_resume:', error);
    return toJson({ resume: null }, 200);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return toJson({ resume: null }, 200);

  return toJson(
    {
      resume: {
        fileId: row.file_id as string,
        uniqueId: row.unique_id as string,
        currentTime: Number(row.current_time_s) || 0,
        duration: Number(row.duration_s) || 0,
        updatedAt: row.updated_at as string,
      },
    },
    200,
  );
};
