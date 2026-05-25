import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { stripGithubRepoForClient } from '~/lib/githubStorage';
import { checkFileAccess } from '~/routes/Dynamic/fun/accessControl';
import { filterFilesByAccess, type FileData } from '~/routes/Api/fun/accessControl';
import { enrichFeedFilesWithInteractions } from '~/routes/Api/fun/enrichFeedFiles';

const PIP_FEED_LIMIT = 20;

function parseIdsParam(param: string | null): string[] {
  if (!param) return [];
  try {
    const parsed = JSON.parse(param);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((id: unknown) => typeof id === 'string' && id.length > 0)
        .slice(0, 500);
    }
  } catch {
    return param
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .slice(0, 500);
  }
  return [];
}

function parseExcludeIds(url: URL): string[] {
  const seen = url.searchParams.get('seen');
  const exclude = url.searchParams.get('exclude_ids');
  const raw = exclude ?? seen;
  return parseIdsParam(raw);
}

type EnrichedPipFeed = Awaited<ReturnType<typeof enrichFeedFilesWithInteractions>>;

export type SecurePipFeedOk = {
  ok: true;
  centerUniqueId: string;
  data: EnrichedPipFeed['data'];
  likedFileIds: string[];
  dislikedFileIds: string[];
  nextCursor: { cursor_pos: number } | null;
  rawCount: number;
  /** Seed the RPC used for this page  client MUST echo it back for paginated calls. */
  seed: string;
};

export type SecurePipFeedErr = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

/**
 * Fresh seed per session when the client doesn't pin one. Using a timestamped, high-entropy
 * value (not `"default"`) means each visit to `/pip/:id` gets a different `get_pip_feed`
 * ordering  avoids the "I keep seeing the same reels" feeling.
 *
 * On pagination, the client echoes the same seed back so subsequent pages line up with the
 * first  otherwise mid-scroll you'd get a brand new ordering and duplicates.
 */
function generateFreshSeed(userId: string | null): string {
  const base = userId ?? 'anon';
  // 36^10 ≈ 3.6e15  plenty of entropy, short enough to pass around in URLs.
  const rand = Math.random().toString(36).slice(2, 12);
  return `${base}-${Date.now().toString(36)}-${rand}`;
}

/**
 * Video-only personalized feed for PiP (RPC `get_pip_feed`), with the same access
 * checks as `/api/feed`: center file must pass `checkFileAccess`, rows pass
 * `filterFilesByAccess`, no `github_repo` in responses.
 */
export async function loadSecurePipFeed(
  request: Request,
  url: URL,
  centerUniqueId: string,
): Promise<SecurePipFeedOk | SecurePipFeedErr> {
  const uniqueId = centerUniqueId.trim();
  if (!uniqueId || uniqueId.length > 512) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Invalid or missing unique_id' },
    };
  }

  if (!db) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Database not initialized' },
    };
  }

  const { data: rawFile, error: fileErr } = await db
    .from('files')
    .select('*')
    .eq('unique_id', uniqueId)
    .maybeSingle();

  if (fileErr) {
    console.error('[pip-feed] file fetch', fileErr);
    return {
      ok: false,
      status: 500,
      body: { error: 'Failed to fetch file' },
    };
  }

  if (!rawFile) {
    return {
      ok: false,
      status: 404,
      body: {
        data: [],
        userActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
        centerUniqueId: uniqueId,
        notFound: true,
      },
    };
  }

  const stripped = stripGithubRepoForClient(rawFile as Record<string, unknown>) as Record<
    string,
    unknown
  >;
  const { thumbnails: _omitThumbnails, ...fileRest } = stripped;
  const file = fileRest as typeof rawFile;

  const accessControl = await checkFileAccess(
    request,
    file as unknown as { is_adult: boolean; is_public: boolean; owner_id: string },
  );

  if (!accessControl.allowed) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'Access denied',
        reason: accessControl.reason,
        accessDenied: true,
        data: [],
        userActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
        centerUniqueId: uniqueId,
      },
    };
  }

  const excludeIds = parseExcludeIds(url);
  const cursorPosParam = url.searchParams.get('cursor_pos');
  const rawSeed = url.searchParams.get('seed');
  const cursorPos = cursorPosParam ? Math.max(0, parseInt(cursorPosParam, 10)) : 0;
  const pExcludeIds =
    excludeIds.length > 0 ? excludeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];

  const user = await isAuthenticated(request, ['id']);
  const userId = user?.id ?? null;

  // Only use the URL seed when the client passes a real one; treat missing / 'default' as
  // "give me a fresh ordering". Cap length to avoid pathological input.
  const seedParam =
    rawSeed && rawSeed !== 'default' && rawSeed.length <= 128
      ? rawSeed
      : generateFreshSeed(userId);

  const feedParams: Record<string, unknown> = {
    p_user_id: userId || null,
    p_limit: PIP_FEED_LIMIT,
    p_category: null,
    p_reels_only: false,
    p_seed: seedParam,
    p_cursor_pos: Number.isFinite(cursorPos) ? cursorPos : 0,
    ...(pExcludeIds.length > 0 ? { p_exclude_ids: pExcludeIds } : {}),
  };

  const { data: feedRows, error: feedErr } = await db.rpc('get_pip_feed', feedParams);

  if (feedErr) {
    console.error('[pip-feed] get_pip_feed', feedErr);
    return {
      ok: false,
      status: 500,
      body: { error: 'Failed to fetch PiP feed' },
    };
  }

  let rows: Record<string, unknown>[] = Array.isArray(feedRows)
    ? feedRows.map((r) => ({ ...(r as Record<string, unknown>) }))
    : [];

  rows = (await filterFilesByAccess(
    request,
    rows as FileData[],
  )) as Record<string, unknown>[];

  const centerId = String(file.id);
  const at = rows.findIndex((r) => String(r.id) === centerId);
  if (at >= 0) {
    const [center] = rows.splice(at, 1);
    rows.unshift(center);
  } else {
    let owner_username: string | null = null;
    let owner_profile_pic: string | null = null;
    let owner_verified = false;
    let owner_about: string | null = null;
    if (file.owner_id) {
      const { data: ownerRow } = await db
        .from('users')
        .select('username, profile_pic, verified, about')
        .eq('id', file.owner_id)
        .maybeSingle();
      if (ownerRow) {
        owner_username = String(ownerRow.username ?? '');
        owner_profile_pic =
          ownerRow.profile_pic != null ? String(ownerRow.profile_pic) : '';
        owner_verified = Boolean(ownerRow.verified);
        owner_about = ownerRow.about != null ? String(ownerRow.about) : null;
      }
    }
    const centerRow: Record<string, unknown> = {
      ...file,
      owner_username,
      owner_profile_pic,
      owner_verified,
      owner_about,
    };
    rows.unshift(centerRow);
  }

  const { data, likedFileIds, dislikedFileIds } = await enrichFeedFilesWithInteractions(
    db,
    rows as Record<string, unknown>[],
    userId,
  );

  const rawCount = (feedRows || []).length;
  const nextCursor =
    rawCount > 0 ? { cursor_pos: (Number.isFinite(cursorPos) ? cursorPos : 0) + rawCount } : null;

  return {
    ok: true,
    centerUniqueId: uniqueId,
    data,
    likedFileIds,
    dislikedFileIds,
    nextCursor,
    rawCount,
    seed: seedParam,
  };
}
