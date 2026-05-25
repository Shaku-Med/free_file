import { data } from 'react-router';
import { trendingContentService } from '~/lib/Services/TrendingContentService';
import { isAuthenticated } from '~/lib/Security/Password';

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
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');
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
 * Compute/refresh trending content (should be protected in production)
 */
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') {
      return toJson({ error: 'Method not allowed' }, 405);
    }

    // Auth check  only authenticated users can trigger trending refresh
    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) {
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
