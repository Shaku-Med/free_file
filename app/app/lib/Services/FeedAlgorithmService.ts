import db from '../Database/supabase';
import { recommendationsService } from './RecommendationsService';
import { trendingContentService } from './TrendingContentService';

export interface FeedItem {
  file_id: string;
  score: number;
  source: 'recommendation' | 'trending' | 'popular';
  reason?: string;
}

export interface FeedQueryParams {
  userId?: string;
  limit?: number;
  offset?: number;
  includeTrending?: boolean;
  includeRecommendations?: boolean;
  timeWindow?: string;
}

export interface FeedResponse {
  data: FeedItem[] | null;
  error: string | null;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

/**
 * Service for generating personalized feeds
 * Follows Single Responsibility Principle - orchestrates feed generation
 * Follows Dependency Inversion Principle - depends on service abstractions
 */
export class FeedAlgorithmService {
  /**
   * Generate a personalized feed for a user
   * Combines recommendations and trending content
   */
  async generateFeed(params: FeedQueryParams): Promise<FeedResponse> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const limit = params.limit || 20;
      const offset = params.offset || 0;
      const includeTrending = params.includeTrending !== false;
      const includeRecommendations = params.includeRecommendations !== false;

      const feedItems: FeedItem[] = [];
      const seenFileIds = new Set<string>();

      // 1. Get user recommendations if authenticated
      if (params.userId && includeRecommendations) {
        const recommendationsResult = await recommendationsService.getRecommendations({
          userId: params.userId,
          limit: limit * 2, // Get more to filter out watched content
        });

        if (recommendationsResult.data) {
          recommendationsResult.data.forEach(rec => {
            if (!seenFileIds.has(rec.file_id)) {
              feedItems.push({
                file_id: rec.file_id,
                score: rec.score,
                source: 'recommendation',
                reason: rec.reason,
              });
              seenFileIds.add(rec.file_id);
            }
          });
        }
      }

      // 2. Get trending content
      if (includeTrending) {
        const trendingResult = await trendingContentService.getTrendingContent({
          timeWindow: params.timeWindow || '24h',
          limit: limit * 2,
        });

        if (trendingResult.data) {
          trendingResult.data.forEach(trending => {
            if (!seenFileIds.has(trending.file_id)) {
              feedItems.push({
                file_id: trending.file_id,
                score: trending.trending_score,
                source: 'trending',
                reason: `Trending in ${params.timeWindow || '24h'}`,
              });
              seenFileIds.add(trending.file_id);
            }
          });
        }
      }

      // 3. Add popular content if needed
      if (feedItems.length < limit) {
        const { data: popularFiles } = await db
          .from('files')
          .select('id, view_count')
          .eq('is_public', true)
          .order('view_count', { ascending: false })
          .limit(limit * 2);

        if (popularFiles) {
          popularFiles.slice(0, limit).forEach((file: any) => {
            if (!seenFileIds.has(file.id)) {
              feedItems.push({
                file_id: file.id,
                score: Number(file.view_count || 0) * 0.1,
                source: 'popular',
                reason: 'Popular content',
              });
              seenFileIds.add(file.id);
            }
          });
        }
      }

      // 4. Sort by score and apply pagination
      feedItems.sort((a, b) => b.score - a.score);
      const paginatedItems = feedItems.slice(offset, offset + limit);
      const hasMore = feedItems.length > offset + limit;

      return {
        data: paginatedItems,
        error: null,
        pagination: {
          page: Math.floor(offset / limit) + 1,
          limit,
          total: feedItems.length,
          hasMore,
        },
      };
    } catch (error) {
      console.error('Exception in generateFeed:', error);
      return { data: null, error: 'Failed to generate feed' };
    }
  }

  /**
   * Get file details for feed items
   */
  async getFeedFiles(feedItems: FeedItem[]): Promise<any[]> {
    try {
      if (!db || feedItems.length === 0) {
        return [];
      }

      const fileIds = feedItems.map(item => item.file_id);

      const { data, error } = await db
        .from('files')
        .select('id, filename, unique_id, up_count, down_count, views, view_count, shares, share_count, file_size, file_type, endpoint, created_at, is_adult, is_public, visibility, owner_id, default_thumbnail, file_title, category, file_description')
        .in('id', fileIds);

      if (error) {
        console.error('Error fetching feed files:', error);
        return [];
      }

      // Maintain order from feedItems
      const fileMap = new Map((data || []).map((file: any) => [file.id, file]));
      return feedItems
        .map(item => fileMap.get(item.file_id))
        .filter(Boolean);
    } catch (error) {
      console.error('Exception in getFeedFiles:', error);
      return [];
    }
  }
}

export const feedAlgorithmService = new FeedAlgorithmService();
