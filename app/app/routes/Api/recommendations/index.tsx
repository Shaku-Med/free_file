import { data } from 'react-router';
import { isAuthenticated } from '~/lib/Security/Password';
import { recommendationsService } from '~/lib/Services/RecommendationsService';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * GET /api/recommendations
 * Get recommendations for the authenticated user
 */
export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return toJson({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const minScore = url.searchParams.get('minScore') 
      ? parseFloat(url.searchParams.get('minScore')!) 
      : undefined;

    const result = await recommendationsService.getRecommendations({
      userId: user.id,
      limit,
      offset,
      minScore,
    });

    if (result.error) {
      return toJson({ error: result.error }, 500);
    }

    return toJson({ data: result.data }, 200);
  } catch (error) {
    console.error('Error in recommendations loader:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};

/**
 * POST /api/recommendations
 * Compute recommendations for the authenticated user
 */
export const action = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return toJson({ error: 'Unauthorized' }, 401);
    }

    if (request.method !== 'POST') {
      return toJson({ error: 'Method not allowed' }, 405);
    }

    const body = await request.json();
    const { recompute } = body;

    // Clear existing recommendations if recomputing
    if (recompute) {
      await recommendationsService.clearUserRecommendations(user.id);
    }

    const result = await recommendationsService.computeRecommendations(user.id);

    if (result.error) {
      return toJson({ error: result.error }, 500);
    }

    return toJson({ 
      success: true, 
      data: result.data,
      count: result.data?.length || 0 
    }, 200);
  } catch (error) {
    console.error('Error in recommendations action:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
