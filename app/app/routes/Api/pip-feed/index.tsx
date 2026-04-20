import { loadSecurePipFeed } from '~/routes/Api/fun/loadSecurePipFeed';
import db from '~/lib/Database/supabase';

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

    const result = await loadSecurePipFeed(request, url, uniqueId);

    if (!result.ok) {
      const status = result.status;
      return new Response(JSON.stringify(result.body), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response(
      JSON.stringify({
        data: result.data,
        userActions: {
          likedFileIds: result.likedFileIds,
          dislikedFileIds: result.dislikedFileIds,
        },
        centerUniqueId: result.centerUniqueId,
        nextCursor: result.nextCursor,
        seed: result.seed,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Feed-Raw-Count': String(result.rawCount),
        },
      },
    );
  } catch (e) {
    console.error('[pip-feed]', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
