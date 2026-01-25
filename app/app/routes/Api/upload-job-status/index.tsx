import db from '~/lib/Database/supabase';

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
    endpoint?: string;      // GitHub path, sent on completed
    thumbnails?: string[];  // Array of thumbnail paths
    duration?: number;      // Video duration in seconds
    is_adult?: boolean;     // NSFW detection result
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
  
  console.log('[upload-job-status] received:', { status, upload_id, user_id, file_name: body?.file_name, endpoint: body?.endpoint });
  
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
    // Update status, endpoint, thumbnails, duration, is_adult
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    const thumbnails = Array.isArray(body?.thumbnails) ? body.thumbnails.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
    const duration = typeof body?.duration === 'number' && body.duration >= 0 ? Math.round(body.duration) : null;
    const is_adult = typeof body?.is_adult === 'boolean' ? body.is_adult : null;
    
    const updateData: Record<string, any> = { upload_status: 'completed' };
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
    
    const { error: updateErr } = await db
      .from('files')
      .update(updateData)
      .eq('unique_id', upload_id);
    if (updateErr) {
      console.warn('[upload-job-status] files update (completed):', updateErr);
    } else {
      console.log('[upload-job-status] files updated for', upload_id, 'endpoint:', endpoint, 'thumbnails:', thumbnails.length, 'duration:', duration, 'is_adult:', is_adult);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
