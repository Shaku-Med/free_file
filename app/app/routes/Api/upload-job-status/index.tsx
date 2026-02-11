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
  
  console.log('[upload-job-status] ========== WEBHOOK RECEIVED ==========');
  console.log('[upload-job-status] status:', status);
  console.log('[upload-job-status] upload_id:', upload_id);
  console.log('[upload-job-status] user_id:', user_id);
  console.log('[upload-job-status] file_name:', body?.file_name);
  console.log('[upload-job-status] endpoint:', body?.endpoint);
  console.log('[upload-job-status] is_adult:', body?.is_adult);
  console.log('[upload-job-status] colors:', body?.colors);
  console.log('[upload-job-status] categories:', body?.categories);
  console.log('[upload-job-status] tags:', body?.tags);
  console.log('[upload-job-status] metadata:', body?.metadata ? JSON.stringify(body.metadata).slice(0, 500) : 'null');
  console.log('[upload-job-status] thumbnails:', body?.thumbnails?.length ?? 0);
  console.log('[upload-job-status] duration:', body?.duration);
  console.log('[upload-job-status] ======================================');
  
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
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 500) : '';
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    const file_type = inferFileType(file_name);
    const { error: filesErr } = await db
      .from('files')
      .upsert(
        {
          unique_id: upload_id,
          filename: file_name,
          endpoint: '', // Empty initially, filled when completed
          upload_status: 'queued',
          owner_id: user_id,
          is_public: is_public,
          file_title: title || file_name.replace(/\.[^./\\]+$/, ''),
          file_description: description,
          file_size: String(file_size),
          file_type,
          created_at: updated_at,
        },
        { onConflict: 'unique_id', ignoreDuplicates: false }
      );
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

    console.log('[upload-job-status] >>> DB UPDATE for', upload_id);
    console.log('[upload-job-status] >>> updateData keys:', Object.keys(updateData));
    console.log('[upload-job-status] >>> updateData:', JSON.stringify(updateData, null, 2).slice(0, 1000));

    const { error: updateErr } = await db
      .from('files')
      .update(updateData)
      .eq('unique_id', upload_id);
    if (updateErr) {
      console.error('[upload-job-status] >>> DB UPDATE FAILED:', updateErr);
    } else {
      console.log('[upload-job-status] >>> DB UPDATE SUCCESS for', upload_id);
      console.log('[upload-job-status] >>> endpoint:', endpoint);
      console.log('[upload-job-status] >>> thumbnails:', thumbnails.length);
      console.log('[upload-job-status] >>> duration:', duration);
      console.log('[upload-job-status] >>> is_adult:', is_adult);
      console.log('[upload-job-status] >>> colors:', colors);
      console.log('[upload-job-status] >>> categories:', categories);
      console.log('[upload-job-status] >>> tags:', tags);
      console.log('[upload-job-status] >>> metadata keys:', Object.keys(metadata));
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
