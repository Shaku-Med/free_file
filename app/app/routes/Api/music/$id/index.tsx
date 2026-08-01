import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { isValidUUID } from '~/lib/Security/inputValidation';
import { stripThumbnailsForClient } from '~/lib/files/reelFilePayload';

/**
 * GET /api/music/:id  the sound page data.
 * `id` is the ORIGINAL file's files.id. Returns the original (when public)
 * plus every public file whose audio fingerprint matched it.
 */

const FILE_COLUMNS =
  'id, created_at, endpoint, filename, unique_id, file_size, file_type, is_adult, owner_id, is_public, visibility, upload_status, file_title, default_thumbnail, views, view_count, share_count, up_count, down_count, is_reel, duration, colors, metadata, original_file_id, comments_enabled';

const USES_LIMIT = 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

type FileRow = Record<string, unknown> & { owner_id?: string | null; id?: string };

function fileIdKey(id: unknown): string {
  return String(id ?? '').toLowerCase();
}

function mapFileForClient(row: FileRow): FileRow {
  const stripped = stripThumbnailsForClient(row);
  return {
    ...stripped,
    like_count: Number(stripped.like_count ?? stripped.up_count) || 0,
    dislike_count: Number(stripped.dislike_count ?? stripped.down_count) || 0,
  };
}

function attachOwners(
  rows: FileRow[],
  owners: Map<string, { id: string; username: string; profile_pic: string; verified: boolean }>,
) {
  return rows.map((row) =>
    mapFileForClient({
      ...row,
      owner: row.owner_id ? owners.get(String(row.owner_id)) ?? null : null,
    }),
  );
}

export const loader = async ({ request, params }: { request: Request; params: { id: string } }) => {
  try {
    if (!db) return json({ error: 'Service unavailable' }, 503);
    const id = params.id?.trim() ?? '';
    if (!isValidUUID(id)) return json({ error: 'Not found' }, 404);

    const user = await isAuthenticated(request, ['id']).catch(() => null);
    const userId = user?.id ?? null;

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

    const original = originalVisible ? attachOwners([originalRow], owners)[0] : null;
    const usesOut = attachOwners(uses, owners);

    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];
    let originalInteractions: {
      like_count: number;
      dislike_count: number;
      comment_count: number;
    } | null = null;

    const interactionIds = [
      ...(original?.id ? [String(original.id)] : []),
      ...usesOut.map((f) => (f.id ? String(f.id) : '')).filter(Boolean),
    ];

    if (interactionIds.length > 0) {
      const { data: batch } = await db.rpc('get_batch_interactions', {
        p_file_ids: interactionIds,
        p_user_id: userId,
      });
      if (Array.isArray(batch)) {
        const byId = new Map<string, (typeof batch)[0]>();
        for (const row of batch) {
          if (row?.file_id) byId.set(fileIdKey(row.file_id), row);
        }

        if (original?.id) {
          const row = byId.get(fileIdKey(original.id));
          const rpcLike = Number(original.like_count) || 0;
          const rpcDislike = Number(original.dislike_count) || 0;
          if (row) {
            if (row.user_has_liked) likedFileIds.push(fileIdKey(original.id));
            if (row.user_has_disliked) dislikedFileIds.push(fileIdKey(original.id));
            originalInteractions = {
              like_count: Math.max(Number(row.like_count) || 0, rpcLike),
              dislike_count: Math.max(Number(row.dislike_count) || 0, rpcDislike),
              comment_count: Number(row.comment_count) || 0,
            };
          } else {
            originalInteractions = {
              like_count: rpcLike,
              dislike_count: rpcDislike,
              comment_count: 0,
            };
          }
        }

        for (const file of usesOut) {
          if (!file.id) continue;
          const row = byId.get(fileIdKey(file.id));
          if (row?.user_has_liked) likedFileIds.push(fileIdKey(file.id));
          if (row?.user_has_disliked) dislikedFileIds.push(fileIdKey(file.id));
        }
      }
    }

    return json({
      original,
      uses: usesOut,
      userActions: { likedFileIds, dislikedFileIds },
      originalInteractions,
    });
  } catch (error) {
    console.error('Music page API error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
