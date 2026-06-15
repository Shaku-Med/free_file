import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { isValidUUID } from '~/lib/Security/inputValidation';
import { mapRpcFileToReelFeedItem } from '~/lib/files/reelFilePayload';

/** YouTube-style "Mix": an auto-generated radio queue seeded from one track. */
const MIX_LIMIT = 25;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function parseExcludeIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id))
        .slice(0, 500);
    }
  } catch {
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => UUID_RE.test(id))
      .slice(0, 500);
  }
  return [];
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    if (!db) return json({ error: 'Service unavailable' }, 503);

    const url = new URL(request.url);

    // Seed may arrive as the internal UUID (`seed_id`) or the public short id
    // (`seed_unique`, what the `?list=RD<unique_id>` URL carries). Resolve the
    // latter to a file id before building the mix.
    let seedId = (url.searchParams.get('seed_id') ?? '').trim();
    if (!isValidUUID(seedId)) {
      const seedUnique = (url.searchParams.get('seed_unique') ?? '').trim();
      if (seedUnique) {
        const { data: row } = await db
          .from('files')
          .select('id')
          .eq('unique_id', seedUnique)
          .maybeSingle();
        seedId = row?.id ? String(row.id) : '';
      }
    }
    if (!isValidUUID(seedId)) return json({ error: 'Invalid seed' }, 400);

    // A nice auto title, YouTube-style: "Mix - <seed track title>". The seed's
    // file_title is usually "Artist - Song", so this reads like "Mix - Nathyrra
    // - North Star" with no extra wrangling.
    const { data: seedRow } = await db
      .from('files')
      .select('file_title, filename')
      .eq('id', seedId)
      .maybeSingle();
    const seedTitle = String(
      (seedRow?.file_title || seedRow?.filename || '').toString(),
    )
      .replace(/\.[a-z0-9]{2,4}$/i, '') // drop a trailing file extension
      .trim();
    const title = seedTitle ? `Mix - ${seedTitle}` : 'Mix';

    const shuffle = url.searchParams.get('seed') ?? 'default';
    const excludeIds = parseExcludeIds(url.searchParams.get('exclude_ids'));
    const limitParam = parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(50, limitParam) : MIX_LIMIT;

    const user = await isAuthenticated(request, ['id']).catch(() => null);
    const userId: string | null = user?.id ?? null;

    const { data: mix, error } = await db.rpc('get_music_mix', {
      p_seed_file_id: seedId,
      p_user_id: userId,
      p_limit: limit,
      p_seed: shuffle,
      ...(excludeIds.length > 0 ? { p_exclude_ids: excludeIds } : {}),
    });

    if (error) {
      console.error('Music mix RPC error:', error);
      return json({ error: 'Failed to build mix' }, 500);
    }

    const filtered = await filterFilesByAccess(request, mix || []);

    const data = filtered.map((file: Record<string, unknown>) => ({
      ...mapRpcFileToReelFeedItem(file),
      // Extra mix-only fields the playlist UI can surface (why it's here / rank).
      mix_reason: file.mix_reason ?? 'related',
      mix_score: Number(file.mix_score) || 0,
    }));

    return json({ seedId, title, data });
  } catch (error) {
    console.error('Music mix error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
