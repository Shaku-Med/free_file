import db from '~/lib/Database/supabase';
import { isValidFileId, isValidUUID } from '~/lib/Security/inputValidation';
import { isAuthenticated } from '~/lib/Security/Password';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const MAX_REQUIRED_SECONDS = 30;
const MIN_REQUIRED_SECONDS = 3;
const MAX_CLAIMED_WATCH_SECONDS = 60;
const MAX_VIEWS_PER_VIEWER_PER_24H = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;
  return 'unknown';
}

function requiredWatchSeconds(durationSeconds: number | null | undefined): number {
  if (durationSeconds == null || durationSeconds <= 0) return MAX_REQUIRED_SECONDS;
  const half = Math.ceil(Number(durationSeconds) * 0.5);
  return Math.min(MAX_REQUIRED_SECONDS, Math.max(MIN_REQUIRED_SECONDS, half));
}

const viewWindowByKey = new Map<string, { count: number; windowStart: number }>();

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function cleanupExpiredViewWindows(): void {
  const now = Date.now();
  for (const [key, entry] of viewWindowByKey.entries()) {
    if (now - entry.windowStart >= WINDOW_MS) viewWindowByKey.delete(key);
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function scheduleCleanup(): void {
  if (cleanupTimer != null) return;
  cleanupTimer = setInterval(() => {
    cleanupExpiredViewWindows();
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function checkViewRateLimit(identifier: string, fileId: string): boolean {
  scheduleCleanup();
  const key = `view:${identifier}:${fileId}`;
  const now = Date.now();
  let entry = viewWindowByKey.get(key);
  if (!entry) {
    viewWindowByKey.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 1, windowStart: now };
    viewWindowByKey.set(key, entry);
    return true;
  }
  if (entry.count >= MAX_VIEWS_PER_VIEWER_PER_24H) return false;
  entry.count += 1;
  return true;
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') return toJson({ error: 'Method not allowed' }, 405);
    if (!db) return toJson({ error: 'Something went wrong.' }, 500);

    const body = await request.json();
    const { fileId, uniqueId, minimumWatchSeconds } = body;

    if (!fileId && !uniqueId) return toJson({ error: 'fileId or uniqueId is required' }, 400);
    if (fileId && !isValidUUID(fileId)) return toJson({ error: 'Invalid fileId format' }, 400);
    if (uniqueId && !isValidFileId(uniqueId)) return toJson({ error: 'Invalid uniqueId format' }, 400);

    let fileQuery = db.from('files').select('id, views, view_count, duration');
    if (fileId) fileQuery = fileQuery.eq('id', fileId);
    else fileQuery = fileQuery.eq('unique_id', uniqueId);
    const { data: file, error: fileError } = await fileQuery.single();
    if (fileError || !file) return toJson({ error: 'File not found' }, 404);

    const required = requiredWatchSeconds(file.duration);
    const rawClaimed = typeof minimumWatchSeconds === 'number' ? minimumWatchSeconds : 0;
    const watchSec = Math.min(rawClaimed, MAX_CLAIMED_WATCH_SECONDS);
    if (watchSec < required) {
      return toJson({ success: true, views: Number(file.views || 0), view_count: Number(file.view_count || 0), counted: false }, 200);
    }

    const ip = getClientIP(request);
    const user = await isAuthenticated(request, ['id']);
    const rateLimitId = user?.id ? `user:${user.id}` : `ip:${ip}`;
    if (!checkViewRateLimit(rateLimitId, file.id)) {
      return toJson({ success: true, views: Number(file.views || 0), view_count: Number(file.view_count || 0), counted: false }, 200);
    }

    const currentViews = Number(file.views || 0);
    const currentViewCount = Number(file.view_count || 0);
    const { data: updatedFile, error: updateError } = await db
      .from('files')
      .update({ views: currentViews + 1, view_count: currentViewCount + 1 })
      .eq('id', file.id)
      .select('views, view_count')
      .single();

    if (updateError) {
      console.error('Error incrementing views:', updateError);
      return toJson({ error: 'Failed to increment views' }, 500);
    }
    return toJson({ success: true, views: Number(updatedFile?.views || 0), view_count: Number(updatedFile?.view_count || 0), counted: true }, 200);
  } catch (error) {
    console.error('Error in views increment action:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
