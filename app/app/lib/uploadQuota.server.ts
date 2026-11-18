import db from '~/lib/Database/supabase';

// Rolling 30-day per-user upload cap, all stored on R2. Reserve before
// queueing, finalize with the real size on completion, refund on
// cancel/failure. MONTHLY_UPLOAD_LIMIT_BYTES can lower or raise it; 10 GiB
// otherwise.
//
// Window length is enforced by the Supabase function `get_monthly_upload_usage`
// (see app/database/migrations/monthly_upload_quota.sql)  if you change it
// there, mirror the marketing-copy window in StorageQuotaMeter too.
const DEFAULT_MONTHLY_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

export function getMonthlyUploadLimitBytes(): number {
  const raw = typeof process !== 'undefined' ? process.env?.MONTHLY_UPLOAD_LIMIT_BYTES : undefined;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_MONTHLY_LIMIT_BYTES;
}

export interface QuotaResult {
  ok: boolean;
  reason?: 'limit' | 'invalid' | 'error';
  used?: number;
  limit?: number;
  remaining?: number;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function reserveUploadQuota(
  userId: string,
  uploadId: string,
  bytes: number
): Promise<QuotaResult> {
  if (!db) return { ok: false, reason: 'error' };
  if (!userId || !uploadId || !Number.isFinite(bytes) || bytes < 0) {
    return { ok: false, reason: 'invalid' };
  }
  try {
    const { data, error } = await db.rpc('reserve_upload_quota', {
      p_user_id: userId,
      p_upload_id: uploadId,
      p_bytes: Math.floor(bytes),
      p_limit_bytes: getMonthlyUploadLimitBytes(),
    });
    if (error) {
      console.error('[uploadQuota] reserve rpc:', error.message ?? error);
      return { ok: false, reason: 'error' };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok === true) {
      return { ok: true, used: num(r.used), limit: num(r.limit), remaining: num(r.remaining) };
    }
    return {
      ok: false,
      reason: r.error === 'limit' ? 'limit' : 'invalid',
      used: num(r.used),
      limit: num(r.limit),
      remaining: num(r.remaining),
    };
  } catch (e) {
    console.error('[uploadQuota] reserve threw:', e);
    return { ok: false, reason: 'error' };
  }
}

// Records actual usage regardless of any prior reservation. Used by the upload
// webhook so uploads sent straight to the Go server still count. Idempotent.
export async function recordUploadUsage(
  userId: string,
  uploadId: string,
  bytes: number,
): Promise<void> {
  if (!db) {
    console.warn('[uploadQuota] record skipped: db not configured');
    return;
  }
  if (!userId || !uploadId) {
    console.warn('[uploadQuota] record skipped: missing userId or uploadId', {
      hasUser: !!userId,
      hasUpload: !!uploadId,
    });
    return;
  }
  const safe = Number.isFinite(bytes) && bytes >= 0 ? Math.floor(bytes) : 0;
  try {
    const { error } = await db.rpc('record_upload_usage', {
      p_user_id: userId,
      p_upload_id: uploadId,
      p_bytes: safe,
      p_scope: 'monthly',
    });
    if (error) {
      // Most common: weekly_upload_quota_record.sql migration not applied yet.
      console.error(
        '[uploadQuota] record rpc:',
        error.message ?? error,
        '(if "function does not exist" -> run weekly_upload_quota_record.sql)',
      );
      return;
    }
    console.log('[uploadQuota] recorded', { uploadId, bytes: safe });
  } catch (e) {
    console.error('[uploadQuota] record threw:', e);
  }
}

export type AdmitResult =
  | { ok: true; used: number; limit: number; remaining: number }
  | { ok: false; reason: 'limit'; used: number; limit: number; remaining: number }
  | { ok: false; reason: 'invalid' | 'error' };

// Lets an upload in when the file itself fits in what the user has left, and
// reserves that much under a per user lock (see upload_admission.sql).
export async function admitUpload(userId: string, uploadId: string, bytes: number): Promise<AdmitResult> {
  if (!db) return { ok: false, reason: 'error' };
  try {
    const { data, error } = await db.rpc('admit_upload', {
      p_user_id: userId,
      p_upload_id: uploadId,
      p_bytes: Math.floor(bytes),
      p_limit_bytes: getMonthlyUploadLimitBytes(),
    });
    if (error) {
      console.error('[uploadQuota] admit rpc:', error.message ?? error);
      return { ok: false, reason: 'error' };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    const used = num(r.used);
    const limit = num(r.limit);
    const remaining = num(r.remaining);
    if (used === undefined || limit === undefined || remaining === undefined) {
      return { ok: false, reason: r.error === 'invalid' ? 'invalid' : 'error' };
    }
    if (r.ok === true) return { ok: true, used, limit, remaining };
    if (r.error === 'limit') return { ok: false, reason: 'limit', used, limit, remaining };
    return { ok: false, reason: 'invalid' };
  } catch (e) {
    console.error('[uploadQuota] admit threw:', e);
    return { ok: false, reason: 'error' };
  }
}

export async function releaseUploadAdmission(userId: string, uploadId: string): Promise<boolean> {
  if (!db) return false;
  try {
    const { error } = await db.rpc('release_upload_admission', { p_user_id: userId, p_upload_id: uploadId });
    if (error) {
      console.error('[uploadQuota] release rpc:', error.message ?? error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[uploadQuota] release threw:', e);
    return false;
  }
}

// Charges a main upload what it stores now. An admitted upload is never
// charged less than its file size or past the room the user had left.
export async function chargeUploadUsage(userId: string, uploadId: string, bytes: number): Promise<void> {
  if (!db) {
    console.warn('[uploadQuota] charge skipped: db not configured');
    return;
  }
  if (!userId || !uploadId) return;
  const safe = Number.isFinite(bytes) && bytes >= 0 ? Math.floor(bytes) : 0;
  try {
    const { error } = await db.rpc('charge_upload', {
      p_user_id: userId,
      p_upload_id: uploadId,
      p_bytes: safe,
      p_limit_bytes: getMonthlyUploadLimitBytes(),
    });
    if (error) {
      console.error('[uploadQuota] charge rpc:', error.message ?? error, '(run upload_admission.sql if it does not exist)');
    }
  } catch (e) {
    console.error('[uploadQuota] charge threw:', e);
  }
}

export async function refundUploadQuota(uploadId: string): Promise<void> {
  if (!db || !uploadId) return;
  try {
    await db.rpc('refund_upload_quota', { p_upload_id: uploadId });
  } catch (e) {
    console.error('[uploadQuota] refund threw:', e);
  }
}

export async function finalizeUploadQuota(
  uploadId: string,
  actualBytes: number | null
): Promise<void> {
  if (!db || !uploadId) return;
  const safe =
    actualBytes != null && Number.isFinite(actualBytes) && actualBytes >= 0
      ? Math.floor(actualBytes)
      : null;
  try {
    await db.rpc('finalize_upload_quota', { p_upload_id: uploadId, p_actual_bytes: safe });
  } catch (e) {
    console.error('[uploadQuota] finalize threw:', e);
  }
}
