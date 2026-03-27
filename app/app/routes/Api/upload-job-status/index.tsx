import db from '~/lib/Database/supabase';
import { textContainsNsfw, DEFAULT_METADATA_WARNING } from '~/lib/nsfwTextCheck';

function inferFileType(filename: string): string {
  if (!filename) return 'application/octet-stream';
  const ext = filename.replace(/^.*\./, '').toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', m4v: 'video/mp4', m3u8: 'application/vnd.apple.mpegurl',
  };
  return map[ext] ?? 'application/octet-stream';
}

/* -------- Series via upload webhook (disabled — uncomment block to re-enable) --------
function isVideoForSeriesLinking(fileType: string, fileName: string): boolean {
  const ft = (fileType || '').toLowerCase();
  if (ft.startsWith('video/')) return true;
  if (ft === 'application/vnd.apple.mpegurl') return true;
  const ext = fileName.replace(/^.*\./, '').toLowerCase();
  return ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'm3u8', 'ogv'].includes(ext);
}

type SeriesPayload = {
  series_id?: string;
  series_title?: string;
  series_desc?: string;
  series_is_public?: boolean;
  is_series_main?: boolean;
  episode_number?: number;
  season_number?: number;
};

function normalizeSeriesFields(o: Record<string, unknown>): SeriesPayload {
  const ep = o.episode_number;
  const sn = o.season_number;
  return {
    series_id: typeof o.series_id === 'string' ? o.series_id : undefined,
    series_title: typeof o.series_title === 'string' ? o.series_title : undefined,
    series_desc: typeof o.series_desc === 'string' ? o.series_desc : undefined,
    series_is_public: typeof o.series_is_public === 'boolean' ? o.series_is_public : undefined,
    is_series_main: o.is_series_main === true,
    episode_number: typeof ep === 'number' && Number.isInteger(ep) ? ep : undefined,
    season_number: typeof sn === 'number' && Number.isInteger(sn) ? sn : undefined,
  };
}

function pickSeriesFromBody(body: Record<string, unknown>): SeriesPayload | null {
  const nested = body.series;
  if (nested && typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
    return normalizeSeriesFields(nested as Record<string, unknown>);
  }
  const title = typeof body.series_title === 'string' ? body.series_title.trim() : '';
  const sid = typeof body.series_id === 'string' ? body.series_id.trim() : '';
  if (body.is_series_main === true || title !== '' || /^[0-9a-f-]{36}$/i.test(sid)) {
    return normalizeSeriesFields(body);
  }
  return null;
}

async function trySeriesPatchOnCompleted(
  uploadId: string,
  userId: string,
  fileName: string,
  s: SeriesPayload | null
): Promise<Record<string, unknown> | null> {
  if (!db || !s || !userId) return null;
  const file_type = inferFileType(fileName);
  if (!isVideoForSeriesLinking(file_type, fileName)) return null;

  const { data: existing, error: selErr } = await db
    .from('files')
    .select('series_id, is_public, filename')
    .eq('unique_id', uploadId)
    .maybeSingle();
  if (selErr || !existing || existing.series_id) return null;

  const fn = typeof existing.filename === 'string' && existing.filename ? existing.filename : fileName;
  const ftRow = inferFileType(fn);
  if (!isVideoForSeriesLinking(ftRow, fn)) return null;

  if (s.is_series_main && s.series_title?.trim()) {
    const seriesIsPublic =
      typeof s.series_is_public === 'boolean' ? s.series_is_public : existing.is_public !== false;
    const { data: seriesRows, error: seriesErr } = await db.rpc('create_series', {
      p_user_id: userId,
      p_title: s.series_title.trim().slice(0, 200),
      p_desc: (s.series_desc ?? '').trim().slice(0, 2000),
      p_is_public: seriesIsPublic,
    });
    if (seriesErr) {
      console.warn('[upload-job-status] create_series failed (completed fallback):', seriesErr.message);
      return null;
    }
    if (Array.isArray(seriesRows) && seriesRows[0]?.id) {
      return { series_id: seriesRows[0].id, is_series_main: true };
    }
    return null;
  }
  if (s.series_id && /^[0-9a-f-]{36}$/i.test(s.series_id)) {
    const patch: Record<string, unknown> = { series_id: s.series_id, is_series_main: false };
    if (s.episode_number != null && s.episode_number >= 1) patch.episode_number = s.episode_number;
    if (s.season_number != null && s.season_number >= 1) patch.season_number = s.season_number;
    return patch;
  }
  return null;
}
-------- end series helpers -------- */

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const secret = request.headers.get('X-Webhook-Secret') ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  const expected = typeof process !== 'undefined' ? process.env?.UPLOAD_WEBHOOK_SECRET : '';
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    job_id?: string;
    status?: string;
    upload_id?: string;
    user_id?: string;
    file_name?: string;
    file_size?: number;
    is_public?: boolean;
    title?: string;
    description?: string;
    endpoint?: string;
    thumbnails?: string[];
    duration?: number;
    is_adult?: boolean;
    colors?: string[];
    categories?: string[];
    tags?: string[];
    metadata?: Record<string, unknown>;
    comments_enabled?: boolean;
    /** null/omitted = unlimited; 0 = no comments; positive = max comments */
    comment_limit?: number | null;
    default_thumbnail?: string;
    // series?: { ... } // when re-enabling series webhook helpers
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const status = typeof body?.status === 'string' ? body.status.trim().toLowerCase() : '';
  const allowed = ['queued', 'running', 'completed', 'failed'];
  const upload_id = typeof body?.upload_id === 'string' ? body.upload_id.trim() : '';
  const user_id = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
  const job_id = typeof body?.job_id === 'string' ? body.job_id.trim() : '';
  console.log('[upload-job-status]', status, upload_id, job_id || '-');

  if (!allowed.includes(status) || !upload_id) {
    console.warn('[upload-job-status] invalid status or upload_id:', { status, upload_id });
    return new Response(JSON.stringify({ error: 'invalid status or upload_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!db) {
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const updated_at = new Date().toISOString();

  if (status === 'queued' && upload_id && user_id && typeof body?.file_name === 'string' && body.file_name.trim()) {
    const file_name = body.file_name.trim();
    const file_size = typeof body?.file_size === 'number' && body.file_size >= 0 ? body.file_size : 0;
    const is_public = typeof body?.is_public === 'boolean' ? body.is_public : true;
    const comments_enabled = typeof body?.comments_enabled === 'boolean' ? body.comments_enabled : true;
    let comment_limit: number | null = null;
    if (body?.comment_limit !== undefined && body?.comment_limit !== null) {
      const n = Number(body.comment_limit);
      if (Number.isInteger(n) && n >= 0 && n <= 1_000_000) {
        comment_limit = n;
      }
    } else if (body?.comment_limit === null) {
      comment_limit = null;
    }
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 500) : '';
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    const file_type = inferFileType(file_name);

    const fileRow: Record<string, unknown> = {
      unique_id: upload_id,
      filename: file_name,
      endpoint: '', // Empty initially, filled when completed
      upload_status: 'queued',
      owner_id: user_id,
      is_public: is_public,
      comments_enabled,
      comment_limit,
      file_title: title || file_name.replace(/\.[^./\\]+$/, ''),
      file_description: description,
      file_size: String(file_size),
      file_type,
      created_at: updated_at,
    };

    /* SERIES (queued) — re-enable with helpers at top of file
    const s = pickSeriesFromBody(body as unknown as Record<string, unknown>);
    if (s && isVideoForSeriesLinking(file_type, file_name)) {
      if (s.is_series_main && s.series_title?.trim()) {
        const seriesIsPublic = typeof s.series_is_public === 'boolean' ? s.series_is_public : is_public;
        const { data: seriesRows, error: seriesErr } = await db.rpc('create_series', {
          p_user_id: user_id,
          p_title: s.series_title.trim().slice(0, 200),
          p_desc: (s.series_desc ?? '').trim().slice(0, 2000),
          p_is_public: seriesIsPublic,
        });
        if (seriesErr) {
          console.warn('[upload-job-status] create_series failed:', seriesErr.message);
        } else if (Array.isArray(seriesRows) && seriesRows[0]?.id) {
          fileRow.series_id = seriesRows[0].id;
          fileRow.is_series_main = true;
        }
      } else if (s.series_id && /^[0-9a-f-]{36}$/i.test(s.series_id)) {
        fileRow.series_id = s.series_id;
        fileRow.is_series_main = false;
        if (typeof s.episode_number === 'number' && Number.isInteger(s.episode_number) && s.episode_number >= 1) {
          fileRow.episode_number = s.episode_number;
        }
        if (typeof s.season_number === 'number' && Number.isInteger(s.season_number) && s.season_number >= 1) {
          fileRow.season_number = s.season_number;
        }
      }
    }
    */

    const { error: filesErr } = await db
      .from('files')
      .upsert(fileRow, { onConflict: 'unique_id', ignoreDuplicates: false });
    if (filesErr) {
      // log but don't fail the webhook; upload_jobs is already updated
      console.warn('[upload-job-status] files upsert (queued):', filesErr);
    } else {
      console.log('[upload-job-status] files created for', upload_id, 'with status queued');
    }
  }

  if (status === 'failed' && upload_id) {
    // Delete the file record on failure so user doesn't see broken entry
    const { error: deleteErr } = await db
      .from('files')
      .delete()
      .eq('unique_id', upload_id);
    if (deleteErr) {
      console.warn('[upload-job-status] files delete (failed):', deleteErr);
    }
  } else if (status === 'running' && upload_id) {
    const { error: updateErr } = await db
      .from('files')
      .update({ upload_status: 'running' })
      .eq('unique_id', upload_id);
    if (updateErr) {
      console.warn('[upload-job-status] files update (running):', updateErr);
    }
  } else if (status === 'completed' && upload_id) {
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    const thumbnails = Array.isArray(body?.thumbnails) ? body.thumbnails.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
    const duration = typeof body?.duration === 'number' && body.duration >= 0 ? Math.round(body.duration) : null;
    const is_adult = typeof body?.is_adult === 'boolean' ? body.is_adult : null;
    const colors = Array.isArray(body?.colors) ? body.colors.filter((c): c is string => typeof c === 'string') : [];
    const categories = Array.isArray(body?.categories) ? body.categories.filter((c): c is string => typeof c === 'string') : [];
    const tags = Array.isArray(body?.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [];
    let metadata = body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? { ...body.metadata } : ({} as Record<string, unknown>);

    const titleForCheck = typeof body?.title === 'string' ? body.title.trim() : '';
    const descriptionForCheck = typeof body?.description === 'string' ? body.description.trim() : '';
    let title = titleForCheck;
    let description = descriptionForCheck;
    if ((!title || !description) && db) {
      const { data: fileRow } = await db.from('files').select('file_title, file_description').eq('unique_id', upload_id).maybeSingle();
      if (fileRow) {
        if (!title) title = typeof fileRow.file_title === 'string' ? fileRow.file_title : '';
        if (!description) description = typeof fileRow.file_description === 'string' ? fileRow.file_description : '';
      }
    }
    const contentIsAdult = is_adult === true;
    const textMayBeNsfw = textContainsNsfw(title) || textContainsNsfw(description);
    if (!contentIsAdult && textMayBeNsfw) {
      metadata.warning = DEFAULT_METADATA_WARNING;
    }

    const updateData: Record<string, any> = { upload_status: 'complete' };
    if (endpoint) {
      updateData.endpoint = endpoint;
    }
    if (thumbnails.length > 0) {
      updateData.thumbnails = thumbnails;
    }
    if (duration !== null) {
      updateData.duration = duration;
    }
    if (is_adult !== null) {
      updateData.is_adult = is_adult;
    }
    if (colors.length > 0) {
      updateData.colors = colors;
    }
    if (categories.length > 0) {
      updateData.categories = categories;
    }
    if (tags.length > 0) {
      updateData.tags = tags;
    }
    if (Object.keys(metadata).length > 0) {
      updateData.metadata = metadata;
    }
    const default_thumbnail = typeof body?.default_thumbnail === 'string' ? body.default_thumbnail.trim() : '';
    if (default_thumbnail) {
      updateData.default_thumbnail = default_thumbnail;
    }

    /* SERIES (completed fallback) — re-enable with helpers at top of file
    const completedFileName = typeof body?.file_name === 'string' ? body.file_name.trim() : '';
    const seriesPicked = pickSeriesFromBody(body as unknown as Record<string, unknown>);
    const seriesPatch = await trySeriesPatchOnCompleted(upload_id, user_id, completedFileName, seriesPicked);
    if (seriesPatch) Object.assign(updateData, seriesPatch);
    */

    const { error: updateErr } = await db
      .from('files')
      .update(updateData)
      .eq('unique_id', upload_id);
    if (updateErr) {
      console.error('[upload-job-status] files update (completed):', upload_id, updateErr.message ?? updateErr);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
