import db from '~/lib/Database/supabase';

// Rolling 30-day per-user upload cap. Reserve before queueing, finalize with
// the real size on completion, refund on cancel/failure. Limit comes from env
// so it is never hardcoded; defaults to 5 GiB.
//
// Window length is enforced by the Supabase function `get_monthly_upload_usage`
// (see app/database/migrations/monthly_upload_quota.sql)  if you change it
// there, mirror the marketing-copy window in StorageQuotaMeter too.
const DEFAULT_MONTHLY_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

export function getMonthlyUploadLimitBytes(): number {
  // Accept either MONTHLY_UPLOAD_LIMIT_BYTES (new name) or
  // WEEKLY_UPLOAD_LIMIT_BYTES (legacy env name)  the value carried the same
  // meaning before/after the rolling window changed, and we don't want a
  // missed-rename in .env to silently drop everyone to the default.
  const monthly = typeof process !== 'undefined' ? process.env?.MONTHLY_UPLOAD_LIMIT_BYTES : undefined;
  const legacy = typeof process !== 'undefined' ? process.env?.WEEKLY_UPLOAD_LIMIT_BYTES : undefined;
  const raw = monthly || legacy;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_MONTHLY_LIMIT_BYTES;
}

/**
 * Backwards-compat alias  any caller still importing the old name keeps
 * working through the rename. Delete once all call sites use the new one.
 */
export const getWeeklyUploadLimitBytes = getMonthlyUploadLimitBytes;

// Extra allowance that opens up once the monthly limit is full: a rolling
// 7-day budget (default 10 GiB). Uploads accepted on it are metered under
// scope='overflow' in the same ledger.
const DEFAULT_OVERFLOW_WEEKLY_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

export function getOverflowWeeklyLimitBytes(): number {
  const raw = typeof process !== 'undefined' ? process.env?.OVERFLOW_WEEKLY_LIMIT_BYTES : undefined;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return DEFAULT_OVERFLOW_WEEKLY_LIMIT_BYTES;
}

export type QuotaScope = 'monthly' | 'overflow';

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
  scope: QuotaScope = 'monthly'
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
      p_scope: scope === 'overflow' ? 'overflow' : 'monthly',
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
