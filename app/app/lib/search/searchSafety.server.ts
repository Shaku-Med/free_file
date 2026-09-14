import { getHiddenOwnerIds } from '~/lib/Security/accountStatus.server';
import { rateLimiter, RateLimiter } from '~/routes/Auth/fun/rateLimit';

// Shared by the search page loader and /api/search so the two can't drift.

type OwnedFile = { id?: string | null; owner_id?: string | null; file_title?: string | null; filename?: string | null };
type SearchUser = { id: string; username: string };

// Page one comes from the search page loader and later pages from /api/search;
// both draw from the same budget.
export function allowSearchRequest(request: Request): boolean {
  return rateLimiter.checkLimit(RateLimiter.getClientIP(request), 'search', 60, 60_000, 120_000).allowed;
}

export function allowSuggestRequest(request: Request): boolean {
  return rateLimiter.checkLimit(RateLimiter.getClientIP(request), 'search_suggest', 120, 60_000, 60_000).allowed;
}

export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Restricted and terminated accounts are withheld from search entirely: results,
// series, and the user list the channel spotlight is built from. Owners still
// see their own.
export async function withoutRestrictedOwners<F extends OwnedFile, S extends OwnedFile, U extends SearchUser>(input: {
  files: F[];
  series: S[];
  users: U[];
  viewerId: string | null;
  likedFileIds: string[];
  dislikedFileIds: string[];
}) {
  const hidden = await getHiddenOwnerIds([
    ...input.files.map((f) => f.owner_id),
    ...input.series.map((f) => f.owner_id),
    ...input.users.map((u) => u.id),
  ]);
  const visible = (ownerId: string | null | undefined) =>
    !ownerId || !hidden.has(ownerId) || ownerId === input.viewerId;

  const files = input.files.filter((f) => visible(f.owner_id));
  const series = input.series.filter((f) => visible(f.owner_id));
  const users = input.users.filter((u) => visible(u.id));
  const ids = new Set([...files, ...series].map((f) => f.id));

  return {
    files,
    series,
    users,
    likedFileIds: input.likedFileIds.filter((id) => ids.has(id)),
    dislikedFileIds: input.dislikedFileIds.filter((id) => ids.has(id)),
  };
}

// A semantic match returns something for any input, so it doesn't prove the
// query was real. Only a query whose words appear in a result can be logged.
export function hasLexicalHit(
  query: string,
  found: { files: OwnedFile[]; series: OwnedFile[]; users: SearchUser[] },
): boolean {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  const texts = [
    ...found.files.flatMap((f) => [f.file_title, f.filename]),
    ...found.series.map((f) => f.file_title),
    ...found.users.map((u) => u.username),
  ];
  return texts.some((text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  });
}
