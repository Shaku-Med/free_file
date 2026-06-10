import { data } from 'react-router';
import { trendingContentService } from '~/lib/Services/TrendingContentService';
import { verifyWebhookSecret } from '~/lib/Security/webhookAuth.server';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * GET /api/trending
 * Get trending content (public endpoint)
 */
export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const timeWindow = url.searchParams.get('timeWindow') || '24h';
    // Clamp pagination so a caller can't request a huge page (DB/CPU DoS).
    const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
    const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
    const offset = Math.min(10_000, Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0));
    const minScore = url.searchParams.get('minScore') 
      ? parseFloat(url.searchParams.get('minScore')!) 
      : undefined;

    const result = await trendingContentService.getTrendingContent({
      timeWindow,
      limit,
      offset,
      minScore,
    });

    if (result.error) {
      return toJson({ error: result.error }, 500);
    }

    return toJson({ data: result.data }, 200);
  } catch (error) {
    console.error('Error in trending loader:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};

/**
 * POST /api/trending
 * Compute/refresh trending content. This is an expensive maintenance job
 * (full recompute), so it's restricted to trusted server-to-server callers
 * (cron / internal) via the shared webhook secret  not any signed-in user.
 */
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') {
      return toJson({ error: 'Method not allowed' }, 405);
    }

    if (!verifyWebhookSecret(request)) {
      return toJson({ error: 'Unauthorized' }, 401);
    }

    const body = await request.json();
    const { timeWindow, refreshAll } = body;

    if (refreshAll) {
      const result = await trendingContentService.refreshAllTrendingContent();
      
      if (result.error) {
        return toJson({ error: result.error }, 500);
      }

      return toJson({ success: true, message: 'All trending content refreshed' }, 200);
    } else {
      const window = timeWindow || '24h';
      const result = await trendingContentService.computeTrendingContent(
        window as '1h' | '24h' | '7d' | '30d' | 'all'
      );

      if (result.error) {
        return toJson({ error: result.error }, 500);
      }

      return toJson({ 
        success: true, 
        data: result.data,
        count: result.data?.length || 0,
        timeWindow: window 
      }, 200);
    }
  } catch (error) {
    console.error('Error in trending action:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
