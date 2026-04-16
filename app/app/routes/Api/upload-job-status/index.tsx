import db from '~/lib/Database/supabase';
import { textContainsNsfw, DEFAULT_METADATA_WARNING } from '~/lib/nsfwTextCheck';
import { isValidUUID } from '~/lib/Security/inputValidation';

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

function parseProcessingProgress(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function isVideoFilename(name: string): boolean {
  if (!name) return false;
  const ext = name.replace(/^.*\./, '').toLowerCase();
  return ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v'].includes(ext);
}

/** First extracted frame path (not thumbnail_preview / json / waveform). */
function firstFrameThumbnailFromList(thumbnails: string[]): string | null {
  for (const t of thumbnails) {
    const s = t.trim();
    if (!s) continue;
    if (/\/thumb_\d+\.jpg$/i.test(s) || /^thumb_\d+\.jpg$/i.test(s)) return s;
  }
  return null;
}

type SeriesWebhookBody = {
  user_id?: string;
  file_name?: string;
  is_new_series?: boolean;
  file_series_id?: string;
  file_series_episode_id?: string;
  new_episode_name?: string;
  /** When creating a new episode, nest it under this episode */
  parent_episode_id?: string;
};

/**
 * Creates file_series / episodes / episode_items and updates `files` for video uploads.
 * Enforces is_series_main vs is_files_series_item mutual exclusivity on updates.
 */
async function applyFileSeriesOnComplete(
  uploadId: string,
  body: SeriesWebhookBody,
  fileNameForTypeCheck: string
): Promise<void> {
  if (!db || !isVideoFilename(fileNameForTypeCheck)) return;

  const ownerId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  if (!ownerId) return;

  const isNewSeries = body.is_new_series === true;
  const fileSeriesId = typeof body.file_series_id === 'string' ? body.file_series_id.trim() : '';
  let fileSeriesEpisodeId =
    typeof body.file_series_episode_id === 'string' ? body.file_series_episode_id.trim() : '';
  const newEpisodeName =
    typeof body.new_episode_name === 'string' ? body.new_episode_name.trim().slice(0, 500) : '';
  const parentEpisodeIdRaw =
    typeof body.parent_episode_id === 'string' ? body.parent_episode_id.trim() : '';

  if (!isNewSeries && !fileSeriesId) return;

  const { count: existingItemCount, error: existErr } = await db
    .from('files_series_episode_items')
    .select('id', { count: 'exact', head: true })
    .eq('file_id', uploadId);
  if (existErr) {
    console.warn(
      '[upload-job-status] series idempotency check:',
      existErr.message || (existErr as { code?: string }).code || String(existErr)
    );
  } else if (existingItemCount && existingItemCount > 0) {
    return;
  }

  if (isNewSeries) {
    if (!newEpisodeName) {
      console.warn('[upload-job-status] new series missing episode name');
      return;
    }
    const { data: seriesRow, error: seriesErr } = await db
      .from('file_series')
      .insert({ file_id: uploadId, owner_id: ownerId })
      .select('id')
      .single();
    if (seriesErr || !seriesRow?.id) {
      console.error('[upload-job-status] file_series insert:', seriesErr?.message ?? seriesErr);
      return;
    }
    const sid = String(seriesRow.id);
    const { data: epRow, error: epErr } = await db
      .from('files_series_episodes')
      .insert({
        feed_series_id: sid,
        owner_id: ownerId,
        episode_name: newEpisodeName,
      })
      .select('id')
      .single();
    if (epErr || !epRow?.id) {
      console.error('[upload-job-status] files_series_episodes insert:', epErr?.message ?? epErr);
      return;
    }
    const eid = String(epRow.id);
    const { error: fileUp } = await db
      .from('files')
      .update({
        is_series_main: true,
        is_files_series_item: false,
        file_series_id: sid,
        file_series_episode_id: eid,
      })
      .eq('unique_id', uploadId);
    if (fileUp) {
      console.error('[upload-job-status] files series (new main) update:', fileUp.message);
      return;
    }
    const { error: itemErr } = await db.from('files_series_episode_items').insert({
      file_series_id: sid,
      file_episode_id: eid,
      owner_id: ownerId,
      file_id: uploadId,
    });
    if (itemErr) console.error('[upload-job-status] files_series_episode_items (new series):', itemErr.message);
    return;
  }

  if (!isValidUUID(fileSeriesId)) {
    console.warn('[upload-job-status] invalid file_series_id');
    return;
  }

  const { data: ser, error: serErr } = await db
    .from('file_series')
    .select('id')
    .eq('id', fileSeriesId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (serErr || !ser) {
    console.warn('[upload-job-status] file_series not found or not owned');
    return;
  }

  if (!fileSeriesEpisodeId && !newEpisodeName) {
    console.warn('[upload-job-status] existing series: missing episode');
    return;
  }

  if (fileSeriesEpisodeId) {
    if (!isValidUUID(fileSeriesEpisodeId)) {
      console.warn('[upload-job-status] invalid file_series_episode_id');
      return;
    }
    const { data: ep, error: epLookupErr } = await db
      .from('files_series_episodes')
      .select('id')
      .eq('id', fileSeriesEpisodeId)
      .eq('feed_series_id', fileSeriesId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (epLookupErr || !ep) {
      console.warn('[upload-job-status] episode not in series or not owned');
      return;
    }
  } else {
    let resolvedParent: string | null = null;
    if (parentEpisodeIdRaw) {
      if (!isValidUUID(parentEpisodeIdRaw)) {
        console.warn('[upload-job-status] invalid parent_episode_id');
        return;
      }
      const { data: parentEp, error: pErr } = await db
        .from('files_series_episodes')
        .select('id')
        .eq('id', parentEpisodeIdRaw)
        .eq('feed_series_id', fileSeriesId)
        .eq('owner_id', ownerId)
        .maybeSingle();
      if (pErr || !parentEp) {
        console.warn('[upload-job-status] parent episode not in series or not owned');
        return;
      }
      resolvedParent = parentEpisodeIdRaw;
    }
    const insertEp: Record<string, unknown> = {
      feed_series_id: fileSeriesId,
      owner_id: ownerId,
      episode_name: newEpisodeName,
    };
    if (resolvedParent) insertEp.parent_episode_id = resolvedParent;
    const { data: epNew, error: epInsErr } = await db
      .from('files_series_episodes')
      .insert(insertEp)
      .select('id')
      .single();
    if (epInsErr || !epNew?.id) {
      console.error('[upload-job-status] new episode insert:', epInsErr?.message ?? epInsErr);
      return;
    }
    fileSeriesEpisodeId = String(epNew.id);
  }

  const { error: fileUp2 } = await db
    .from('files')
    .update({
      is_series_main: false,
      is_files_series_item: true,
      file_series_id: fileSeriesId,
      file_series_episode_id: fileSeriesEpisodeId,
    })
    .eq('unique_id', uploadId);
  if (fileUp2) {
    console.error('[upload-job-status] files series (episode item) update:', fileUp2.message);
    return;
  }

  const { error: itemErr2 } = await db.from('files_series_episode_items').insert({
    file_series_id: fileSeriesId,
    file_episode_id: fileSeriesEpisodeId,
    owner_id: ownerId,
    file_id: uploadId,
  });
  if (itemErr2) console.error('[upload-job-status] files_series_episode_items (existing series):', itemErr2.message);
}

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
    is_new_series?: boolean;
    file_series_id?: string;
    file_series_episode_id?: string;
    new_episode_name?: string;
    parent_episode_id?: string;
    github_repo?: string;
    /** 0–100 from Go worker while processing */
    progress?: number;
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

    const uploadTargetRepo =
      (typeof body?.github_repo === 'string' ? body.github_repo.trim() : '') ||
      (typeof process.env.GITHUB_REPO === 'string' ? process.env.GITHUB_REPO.trim() : '');
    const fileRow: Record<string, unknown> = {
      unique_id: upload_id,
      filename: file_name,
      endpoint: '', // Empty initially, filled when completed
      upload_status: 'queued',
      processing_progress: parseProcessingProgress(body.progress) ?? 0,
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
    if (uploadTargetRepo) {
      fileRow.github_repo = uploadTargetRepo;
    }

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
    const p = parseProcessingProgress(body.progress);
    const patch: Record<string, unknown> = {
      upload_status: 'running',
      processing_progress: p !== null ? p : 0,
    };

    const thumbnails = Array.isArray(body?.thumbnails) ? body.thumbnails.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
    if (thumbnails.length > 0) {
      patch.thumbnails = thumbnails;
    }
    const duration = typeof body?.duration === 'number' && body.duration >= 0 ? Math.round(body.duration) : null;
    if (duration !== null) {
      patch.duration = duration;
    }
    const defaultThumb = typeof body?.default_thumbnail === 'string' ? body.default_thumbnail.trim() : '';
    if (defaultThumb) {
      patch.default_thumbnail = defaultThumb;
    } else if (thumbnails.length > 0) {
      const inferred = firstFrameThumbnailFromList(thumbnails);
      if (inferred) {
        patch.default_thumbnail = inferred;
      }
    }

    const { error: updateErr } = await db.from('files').update(patch).eq('unique_id', upload_id);
    if (updateErr) {
      console.warn('[upload-job-status] files update (running):', updateErr);
    } else if (thumbnails.length > 0) {
      console.log('[upload-job-status] thumbnails set early for', upload_id, '(' + thumbnails.length + ' paths)');
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

    const updateData: Record<string, any> = { upload_status: 'complete', processing_progress: null };
    if (endpoint) {
      updateData.endpoint = endpoint;
    }
    const ghRepo =
      typeof body?.github_repo === 'string' ? body.github_repo.trim() : '';
    if (ghRepo) {
      updateData.github_repo = ghRepo;
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
    const explicitDefault =
      typeof body?.default_thumbnail === 'string' ? body.default_thumbnail.trim() : '';
    if (explicitDefault) {
      updateData.default_thumbnail = explicitDefault;
    } else if (thumbnails.length > 0) {
      const inferred = firstFrameThumbnailFromList(thumbnails);
      if (inferred) {
        updateData.default_thumbnail = inferred;
      }
    }

    const { error: updateErr } = await db
      .from('files')
      .update(updateData)
      .eq('unique_id', upload_id);
    if (updateErr) {
      console.error('[upload-job-status] files update (completed):', upload_id, updateErr.message ?? updateErr);
    } else {
      const fn = typeof body.file_name === 'string' ? body.file_name.trim() : '';
      await applyFileSeriesOnComplete(upload_id, body, fn);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
