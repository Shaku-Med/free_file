import { mixGidFromSeed } from '~/lib/music/mixId';

/**
 * Channel spotlight for search — our stand-in for what YouTube does when a
 * query resolves to an ENTITY instead of to plain videos.
 *
 * Verified from saved YouTube result pages: a plain creator match renders
 * `ytd-channel-renderer` + a "Latest from X" `ytd-shelf-renderer`, while a
 * recognised entity gets `ytd-universal-watch-card-renderer`, and a MUSIC
 * ARTIST gets that card with music actions (Mix / YouTube Music). The layout
 * changes because the ENTITY TYPE changes, not because the words differ.
 *
 * We can't do a Knowledge Graph, but we can do the part that matters: work out
 * whether the matched channel is a music artist and hand the UI a `kind`, plus
 * a ready-made mix gid so the artist variant can offer a Mix button.
 *
 * Shared by the /api/search route and the search page loader so the two can't
 * drift apart.
 */

export interface SpotlightChannel {
  id: string;
  username: string;
  profile_pic: string;
  file_count: number;
}

export interface Spotlight {
  kind: 'artist' | 'creator';
  channel: SpotlightChannel;
  shelf: Array<Record<string, unknown>>;
  mixGid: string | null;
  mixSeedUniqueId: string | null;
}

const SHELF_COLUMNS =
  'id, unique_id, file_title, filename, file_type, endpoint, default_thumbnail, created_at, duration, view_count, is_music, is_reel';

/** Enough music, and mostly music, before we call someone an artist. */
const MIN_MUSIC_FILES = 3;
const ARTIST_MUSIC_RATIO = 0.6;

export async function buildSpotlight(
  db: any,
  query: string,
  users: SpotlightChannel[],
): Promise<Spotlight | null> {
  if (!db || users.length === 0) return null;

  const q = query.trim().toLowerCase();
  // Require an exact or prefix handle hit. A loose substring match is too weak
  // to justify taking over the top of the results page.
  const best =
    users.find((u) => u.username.toLowerCase() === q) ??
    users.find((u) => u.username.toLowerCase().startsWith(q)) ??
    null;
  if (!best) return null;

  const { data: ownerFiles } = await db
    .from('files')
    .select(SHELF_COLUMNS)
    .eq('owner_id', best.id)
    .eq('is_public', true)
    .eq('is_adult', false)
    .eq('upload_status', 'complete')
    .order('created_at', { ascending: false })
    .limit(50);

  const rows: any[] = Array.isArray(ownerFiles) ? ownerFiles : [];
  if (rows.length === 0) return null;

  const musicRows = rows.filter((r) => r.is_music === true);
  const isArtist =
    musicRows.length >= MIN_MUSIC_FILES &&
    musicRows.length / rows.length >= ARTIST_MUSIC_RATIO;

  // Artists lead with their biggest tracks; creators lead with what's newest.
  const shelf = (
    isArtist
      ? [...musicRows].sort(
          (a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0),
        )
      : rows
  ).slice(0, 12);

  const topTrack = isArtist ? shelf[0] : null;

  return {
    kind: isArtist ? 'artist' : 'creator',
    channel: best,
    shelf,
    mixGid: topTrack?.unique_id ? mixGidFromSeed(String(topTrack.unique_id)) : null,
    mixSeedUniqueId: topTrack?.unique_id ?? null,
  };
}
