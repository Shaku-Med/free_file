import db from '../Database/supabase';

export interface RecommendationRecord {
  id?: string;
  user_id: string;
  file_id: string;
  score: number;
  reason?: string;
  computed_at?: string;
}

export interface RecommendationQueryParams {
  userId: string;
  limit?: number;
  offset?: number;
  minScore?: number;
}

export interface RecommendationResponse {
  data: RecommendationRecord[] | null;
  error: string | null;
}

/**
 * Service for managing user recommendations
 * Follows Single Responsibility Principle - only handles recommendation operations
 */
export class RecommendationsService {
  /**
   * Get recommendations for a user
   */
  async getRecommendations(params: RecommendationQueryParams): Promise<RecommendationResponse> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      let query = db
        .from('user_recommendations')
        .select('*')
        .eq('user_id', params.userId)
        .order('score', { ascending: false });

      if (params.minScore !== undefined) {
        query = query.gte('score', params.minScore);
      }

      if (params.limit) {
        query = query.limit(params.limit);
      }

      if (params.offset) {
        query = query.range(params.offset, params.offset + (params.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching recommendations:', error);
        return { data: null, error: 'Failed to fetch recommendations' };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Exception in getRecommendations:', error);
      return { data: null, error: 'Failed to fetch recommendations' };
    }
  }

  /**
   * Store or update a recommendation
   */
  async storeRecommendation(recommendation: Omit<RecommendationRecord, 'id' | 'computed_at'>): Promise<RecommendationResponse> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data, error } = await db
        .from('user_recommendations')
        .upsert(
          {
            ...recommendation,
            computed_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,file_id',
            ignoreDuplicates: false,
          }
        )
        .select()
        .single();

      if (error) {
        console.error('Error storing recommendation:', error);
        return { data: null, error: 'Failed to store recommendation' };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Exception in storeRecommendation:', error);
      return { data: null, error: 'Failed to store recommendation' };
    }
  }

  /**
   * Store multiple recommendations in batch
   */
  async storeRecommendations(recommendations: Omit<RecommendationRecord, 'id' | 'computed_at'>[]): Promise<RecommendationResponse> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const now = new Date().toISOString();
      const recommendationsWithTimestamp = recommendations.map(rec => ({
        ...rec,
        computed_at: now,
      }));

      const { data, error } = await db
        .from('user_recommendations')
        .upsert(recommendationsWithTimestamp, {
          onConflict: 'user_id,file_id',
          ignoreDuplicates: false,
        })
        .select();

      if (error) {
        console.error('Error storing recommendations:', error);
        return { data: null, error: 'Failed to store recommendations' };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Exception in storeRecommendations:', error);
      return { data: null, error: 'Failed to store recommendations' };
    }
  }

  /**
   * Clear old recommendations for a user (before recomputing)
   */
  async clearUserRecommendations(userId: string): Promise<{ success: boolean; error: string | null }> {
    try {
      if (!db) {
        return { success: false, error: 'Database not initialized' };
      }

      const { error } = await db
        .from('user_recommendations')
        .delete()
        .eq('user_id', userId);

      if (error) {
        console.error('Error clearing recommendations:', error);
        return { success: false, error: 'Failed to clear recommendations' };
      }

      return { success: true, error: null };
    } catch (error) {
      console.error('Exception in clearUserRecommendations:', error);
      return { success: false, error: 'Failed to clear recommendations' };
    }
  }

  /**
   * Compute recommendations for a user based on preferences
   * This is a simplified version - can be extended with ML algorithms
   */
  async computeRecommendations(userId: string): Promise<RecommendationResponse> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      // Get files ordered by engagement
      const { data: files, error: filesError } = await db
        .from('files')
        .select('id')
        .is('is_public', true)
        .order('view_count', { ascending: false })
        .limit(100);

      if (filesError) {
        console.error('Error fetching files for recommendations:', filesError);
        return { data: null, error: 'Failed to compute recommendations' };
      }

      // Generate recommendations with scores
      const recommendations: Omit<RecommendationRecord, 'id' | 'computed_at'>[] = [];

      (files || []).forEach((file: any, index: number) => {
        // Simple scoring: higher position = higher score (can be improved with ML)
        const score = 100 - (index * 0.5);
        recommendations.push({
          user_id: userId,
          file_id: file.id,
          score: Math.max(0, score),
          reason: 'Based on trending content',
        });
      });

      // Store recommendations
      if (recommendations.length > 0) {
        return await this.storeRecommendations(recommendations);
      }

      return { data: [], error: null };
    } catch (error) {
      console.error('Exception in computeRecommendations:', error);
      return { data: null, error: 'Failed to compute recommendations' };
    }
  }
}

export const recommendationsService = new RecommendationsService();
