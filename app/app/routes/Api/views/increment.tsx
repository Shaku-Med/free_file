import db from '~/lib/Database/supabase';
import { isValidFileId, isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;
  return 'unknown';
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({ error: 'Something went wrong.' }, 500);

    const body = await request.json();
    const { fileId, uniqueId, currentTimeSeconds, durationSeconds } = body;

    if (!fileId && !uniqueId) return toJson({ error: 'fileId or uniqueId is required' }, 400);
    if (fileId && !isValidUUID(fileId)) return toJson({ error: 'Invalid fileId format' }, 400);
    if (uniqueId && !isValidFileId(uniqueId)) return toJson({ error: 'Invalid uniqueId format' }, 400);

    let fileQuery = db.from('files').select('id, views, view_count, duration, file_type');
    if (fileId) fileQuery = fileQuery.eq('id', fileId);
    else fileQuery = fileQuery.eq('unique_id', uniqueId);
    const { data: file, error: fileError } = await fileQuery.single();
    if (fileError || !file) return toJson({ error: 'File not found' }, 404);

    const ip = getClientIP(request);
    const user = await isAuthenticated(request, ['id']);
    const ua = request.headers.get('user-agent') ?? 'unknown';
    const viewerKey = user?.id
      ? `user:${user.id}`
      : `ipua:${ip}:${ua}`.slice(0, 240);

    const ct = Number(currentTimeSeconds);
    const dur =
      durationSeconds != null
        ? Number(durationSeconds)
        : file.duration != null
          ? Number(file.duration)
          : 0;

    const { data: rpcData, error: rpcErr } = await db.rpc('increment_file_view_if_eligible', {
      p_file_id: file.id,
      p_user_id: user?.id ?? null,
      p_viewer_key: viewerKey,
      p_current_time_s: Number.isFinite(ct) ? ct : 0,
      p_duration_s: Number.isFinite(dur) ? dur : 0,
      p_file_type: String(file.file_type ?? ''),
    });

    if (rpcErr) {
      console.error('increment_file_view_if_eligible:', rpcErr);
      return toJson({ error: 'Failed to increment views' }, 500);
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const counted = Boolean(row?.counted);
    const views = Number(row?.views ?? file.views ?? 0);
    const view_count = Number(row?.view_count ?? file.view_count ?? 0);

    return toJson({ success: true, views, view_count, counted }, 200);
  } catch (error) {
    console.error('Error in views increment action:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
