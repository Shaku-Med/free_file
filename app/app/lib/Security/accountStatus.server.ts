import db from '~/lib/Database/supabase';

/**
 * Account enforcement. The single server side authority.
 *
 * Every read path that serves someone else's content asks this module whether
 * the OWNER is allowed to be seen, and every write path asks whether the ACTOR
 * is allowed to act. See docs/Moderation.md.
 *
 * Client-side hiding is not enforcement: a restricted account's media must fail
 * to load even when someone has a direct link, so the check belongs here rather
 * than in a component.
 */

export type AccountStatus = 'active' | 'strike' | 'restricted' | 'terminated';

/** Statuses whose content is withheld from everyone except the owner. */
const HIDDEN_STATUSES: ReadonlySet<AccountStatus> = new Set([
  'restricted',
  'terminated',
]);

/** Statuses that block acting on the platform (upload, comment, like…). */
const BLOCKED_STATUSES: ReadonlySet<AccountStatus> = new Set([
  'restricted',
  'terminated',
]);

/**
 * `strike` deliberately restricts NOTHING on its own. The offending file is
 * removed and the counter increments, but the account keeps working. Escalation
 * to `restricted` is a separate decision, so a single false positive from an
 * unreliable classifier can't silently disable someone.
 */

export interface AccountState {
  status: AccountStatus;
  reason: string | null;
  expiresAt: string | null;
}

const ACTIVE: AccountState = { status: 'active', reason: null, expiresAt: null };

/**
 * Postgres `undefined_column`. Raised when this code is deployed before
 * moderation_account_status.sql has run.
 *
 * This case must fail OPEN, and it is the one exception to the fail-closed rule
 * below. Treating "the feature isn't installed yet" as "hide everything" would
 * blank the entire platform on the first deploy that lands ahead of the
 * migration, an outage caused by a safety feature that isn't even switched on.
 * Real errors (timeouts, permissions) still fail closed.
 */
const UNDEFINED_COLUMN = '42703';

function schemaMissing(error: { code?: string } | null): boolean {
  return error?.code === UNDEFINED_COLUMN;
}

let warnedMissingSchema = false;
function warnSchemaOnce() {
  if (warnedMissingSchema) return;
  warnedMissingSchema = true;
  console.warn(
    '[moderation] users.account_status is missing, enforcement is INACTIVE. ' +
      'Run app/database/migrations/moderation_account_status.sql.',
  );
}

function normalize(value: unknown): AccountStatus {
  return value === 'strike' || value === 'restricted' || value === 'terminated'
    ? value
    : 'active';
}

/** Current enforcement state for one account. Unknown users read as active. */
export async function getAccountState(
  userId: string | null | undefined,
): Promise<AccountState> {
  if (!db || !userId) return ACTIVE;
  const { data, error } = await db
    .from('users')
    .select('account_status, status_reason, status_expires_at')
    .eq('id', userId)
    .maybeSingle();
  if (schemaMissing(error)) {
    warnSchemaOnce();
    return ACTIVE;
  }
  if (error || !data) return ACTIVE;

  const status = normalize((data as any).account_status);
  const expiresAt = (data as any).status_expires_at ?? null;

  // Treat a lapsed restriction as already lifted, so enforcement doesn't linger
  // if the expiry sweep hasn't run yet.
  if (status === 'restricted' && expiresAt && Date.parse(expiresAt) <= Date.now()) {
    return ACTIVE;
  }

  return { status, reason: (data as any).status_reason ?? null, expiresAt };
}

/** True when this account may upload, comment, like, or otherwise act. */
export async function canAct(userId: string | null | undefined): Promise<boolean> {
  const { status } = await getAccountState(userId);
  return !BLOCKED_STATUSES.has(status);
}

/**
 * Owners whose content must be withheld, from a batch of owner ids.
 *
 * Feeds, search and related lists carry rows from many different owners, so
 * they need ONE query rather than a per-row lookup. Returns a Set for O(1)
 * filtering at the call site.
 *
 * Fails CLOSED on a database error: an empty result would silently publish
 * restricted content, so the error path treats every owner as hidden.
 */
export async function getHiddenOwnerIds(
  ownerIds: Array<string | null | undefined>,
): Promise<Set<string>> {
  const ids = Array.from(
    new Set(ownerIds.filter((id): id is string => Boolean(id))),
  );
  if (!db || ids.length === 0) return new Set();

  const { data, error } = await db
    .from('users')
    .select('id, account_status, status_expires_at')
    .in('id', ids)
    .neq('account_status', 'active');

  // Feature not installed yet -> nothing is enforced (see UNDEFINED_COLUMN).
  if (schemaMissing(error)) {
    warnSchemaOnce();
    return new Set();
  }
  // Any REAL failure fails closed: an empty set here would publish restricted
  // content, so an unreachable/erroring database withholds instead.
  if (error) {
    console.error('accountStatus: hidden-owner lookup failed, failing closed');
    return new Set(ids);
  }

  const hidden = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const status = normalize(row.account_status);
    if (!HIDDEN_STATUSES.has(status)) continue;
    const exp = row.status_expires_at;
    if (status === 'restricted' && exp && Date.parse(exp) <= Date.now()) continue;
    hidden.add(String(row.id));
  }
  return hidden;
}

/**
 * Filter a list of file rows down to what this viewer may see.
 * The owner always keeps sight of their own library. A restriction unlists
 * content, it doesn't confiscate it.
 */
export async function filterByOwnerStatus<T extends Record<string, unknown>>(
  rows: T[],
  viewerId: string | null | undefined,
  ownerKey: keyof T = 'owner_id' as keyof T,
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const hidden = await getHiddenOwnerIds(rows.map((r) => String(r[ownerKey] ?? '')));
  if (hidden.size === 0) return rows;
  return rows.filter((r) => {
    const owner = String(r[ownerKey] ?? '');
    return !hidden.has(owner) || (viewerId && owner === viewerId);
  });
}

/**
 * Whether a single file may be served to this viewer.
 * Used by the media paths (manifests, segments, images) where there's one file
 * and a direct-link risk.
 */
export async function canServeOwnerContent(
  ownerId: string | null | undefined,
  viewerId: string | null | undefined,
): Promise<boolean> {
  if (!ownerId) return true;
  if (viewerId && viewerId === ownerId) return true;
  const hidden = await getHiddenOwnerIds([ownerId]);
  return !hidden.has(ownerId);
}
