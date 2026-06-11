import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { isValidUUID } from '~/lib/Security/inputValidation';

/**
 * GET /api/music/:id  the sound page data.
 * `id` is the ORIGINAL file's files.id. Returns the original (when public)
 * plus every public file whose audio fingerprint matched it.
 */

const FILE_COLUMNS =
  'id, created_at, endpoint, filename, unique_id, file_size, file_type, is_adult, owner_id, is_public, upload_status, file_description, file_title, default_thumbnail, thumbnails, view_count, share_count, is_reel, duration, categories, tags, colors, metadata, original_file_id';

const USES_LIMIT = 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

type FileRow = Record<string, unknown> & { owner_id?: string | null };

function attachOwners(
  rows: FileRow[],
  owners: Map<string, { id: string; username: string; profile_pic: string; verified: boolean }>,
) {
  return rows.map((row) => ({
    ...row,
    owner: row.owner_id ? owners.get(String(row.owner_id)) ?? null : null,
  }));
}

export const loader = async ({ request, params }: { request: Request; params: { id: string } }) => {
  try {
    if (!db) return json({ error: 'Service unavailable' }, 503);
    const id = params.id?.trim() ?? '';
    if (!isValidUUID(id)) return json({ error: 'Not found' }, 404);

    // Auth only personalizes nothing here yet, but keeps parity with other
    // feed endpoints if we later add like-state.
    await isAuthenticated(request, ['id']).catch(() => null);

    const [originalRes, usesRes] = await Promise.all([
      db.from('files').select(FILE_COLUMNS).eq('id', id).maybeSingle(),
      db
        .from('files')
        .select(FILE_COLUMNS)
        .eq('original_file_id', id)
        .eq('is_public', true)
        .eq('is_adult', false)
        .eq('upload_status', 'complete')
        .order('view_count', { ascending: false })
        .limit(USES_LIMIT),
    ]);

    const originalRow = originalRes.data as FileRow | null;
    const originalVisible =
      originalRow &&
      originalRow.is_public === true &&
      originalRow.is_adult !== true &&
      (originalRow as { upload_status?: string }).upload_status === 'complete';

    const uses = Array.isArray(usesRes.data) ? (usesRes.data as FileRow[]) : [];

    // One owners lookup for every row on the page.
    const ownerIds = Array.from(
      new Set(
        [...(originalVisible ? [originalRow] : []), ...uses]
          .map((r) => (r.owner_id ? String(r.owner_id) : ''))
          .filter(Boolean),
      ),
    );
    const owners = new Map<string, { id: string; username: string; profile_pic: string; verified: boolean }>();
    if (ownerIds.length > 0) {
      const { data: users } = await db
        .from('users')
        .select('id, username, profile_pic, verified')
        .in('id', ownerIds);
      for (const u of (users ?? []) as Array<{ id: string; username: string; profile_pic: string | null; verified: boolean | null }>) {
        owners.set(String(u.id), {
          id: String(u.id),
          username: u.username,
          profile_pic: u.profile_pic || '',
          verified: u.verified ?? false,
        });
      }
    }

    return json({
      original: originalVisible ? attachOwners([originalRow], owners)[0] : null,
      uses: attachOwners(uses, owners),
    });
  } catch (error) {
    console.error('Music page API error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
