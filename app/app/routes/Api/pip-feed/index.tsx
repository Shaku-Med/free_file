import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { checkFileAccess } from '~/routes/Dynamic/fun/accessControl';
import { filterFilesByAccess } from '~/routes/Api/fun/accessControl';
import { enrichFeedFilesWithInteractions } from '~/routes/Api/fun/enrichFeedFiles';
import { stripGithubRepoForClient } from '~/lib/githubStorage';

const RELATED_LIMIT = 40;

export const loader = async ({ request }: { request: Request }) => {
  try {
    if (!db) {
      return new Response(JSON.stringify({ error: 'Database not initialized' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const uniqueId = url.searchParams.get('unique_id')?.trim();
    if (!uniqueId) {
      return new Response(JSON.stringify({ error: 'Missing unique_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: rawFile, error: fileErr } = await db
      .from('files')
      .select('*')
      .eq('unique_id', uniqueId)
      .maybeSingle();

    if (fileErr) {
      console.error('[pip-feed] file fetch', fileErr);
      return new Response(JSON.stringify({ error: 'Failed to fetch file' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!rawFile) {
      return new Response(
        JSON.stringify({
          data: [],
          userActions: { likedFileIds: [], dislikedFileIds: [] },
          centerUniqueId: uniqueId,
          notFound: true,
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const stripped = stripGithubRepoForClient(
      rawFile as Record<string, unknown>
    ) as Record<string, unknown>;
    const { thumbnails: _omitThumbnails, ...fileRest } = stripped;
    const file = fileRest as typeof rawFile;

    const accessControl = await checkFileAccess(
      request,
      file as unknown as {
        is_adult: boolean;
        is_public: boolean;
        owner_id: string;
      }
    );

    if (!accessControl.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Access denied',
          reason: accessControl.reason,
          accessDenied: true,
          data: [],
          userActions: { likedFileIds: [], dislikedFileIds: [] },
          centerUniqueId: uniqueId,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const user = await isAuthenticated(request, ['id']);
    const userId = user?.id ?? null;

    const { data: relatedRows, error: relErr } = await db.rpc('get_related', {
      p_file_id: file.id,
      p_user_id: userId,
      p_limit: RELATED_LIMIT,
      p_cursor_pos: 0,
    });

    if (relErr) {
      console.error('[pip-feed] get_related', relErr);
    }

    let rows: Record<string, unknown>[] = Array.isArray(relatedRows)
      ? relatedRows.map((r) => ({ ...(r as Record<string, unknown>) }))
      : [];

    rows = await filterFilesByAccess(request, rows);

    const centerId = file.id as string;
    const at = rows.findIndex((r) => r.id === centerId);
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
          owner_about =
            ownerRow.about != null ? String(ownerRow.about) : null;
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

    const { data, likedFileIds, dislikedFileIds } =
      await enrichFeedFilesWithInteractions(
        db,
        rows as Record<string, unknown>[],
        userId
      );

    return new Response(
      JSON.stringify({
        data,
        userActions: { likedFileIds, dislikedFileIds },
        centerUniqueId: uniqueId,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (e) {
    console.error('[pip-feed]', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
