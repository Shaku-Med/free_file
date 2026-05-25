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
   * Compute personalized recommendations using the user's engagement signals:
   *   1. Categories & tags from files the user liked → find similar content
   *   2. Creators the user engages with → surface more of their uploads
   *   3. Trending content the user hasn't seen → discovery/explore mix
   *
   * Scoring: affinity-matched content scores highest, creator affinity next,
   * then trending backfill. Caps per creator prevent one uploader dominating.
   */
  async computeRecommendations(userId: string): Promise<RecommendationResponse> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const seenFileIds = new Set<string>();
      const recommendations: Omit<RecommendationRecord, 'id' | 'computed_at'>[] = [];
      const MAX_PER_CREATOR = 5;
      const creatorCounts = new Map<string, number>();

      const addRec = (fileId: string, ownerId: string | null, score: number, reason: string) => {
        if (seenFileIds.has(fileId)) return;
        if (ownerId) {
          const count = creatorCounts.get(ownerId) ?? 0;
          if (count >= MAX_PER_CREATOR) return;
          creatorCounts.set(ownerId, count + 1);
        }
        seenFileIds.add(fileId);
        recommendations.push({ user_id: userId, file_id: fileId, score: Math.max(0, score), reason });
      };

      // 1) Fetch user's liked files to extract preference signals
      const { data: likedFiles } = await db
        .from('file_likes')
        .select('file_id, files!inner(id, categories, tags, owner_id)')
        .eq('user_id', userId)
        .eq('is_like', true)
        .order('created_at', { ascending: false })
        .limit(50);

      const preferredCategories = new Map<string, number>();
      const preferredTags = new Map<string, number>();
      const preferredCreators = new Set<string>();
      const likedFileIds = new Set<string>();

      if (Array.isArray(likedFiles)) {
        for (const row of likedFiles) {
          const f = (row as Record<string, any>).files;
          if (!f) continue;
          likedFileIds.add(f.id);
          if (f.owner_id) preferredCreators.add(f.owner_id);
          const cats: string[] = Array.isArray(f.categories) ? f.categories : [];
          cats.forEach((c: string) => preferredCategories.set(c, (preferredCategories.get(c) ?? 0) + 1));
          const tags: string[] = Array.isArray(f.tags) ? f.tags : [];
          tags.forEach((t: string) => preferredTags.set(t, (preferredTags.get(t) ?? 0) + 1));
        }
      }

      // 2) Fetch watch history for recency signal
      const { data: watchHistory } = await db
        .from('watch_history')
        .select('file_id')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(100);

      const watchedIds = new Set<string>();
      if (Array.isArray(watchHistory)) {
        watchHistory.forEach((w: any) => { if (w.file_id) watchedIds.add(w.file_id); });
      }

      // 3) Category-matched content (highest scores)
      const topCategories = [...preferredCategories.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cat]) => cat);

      if (topCategories.length > 0) {
        const { data: catFiles } = await db
          .from('files')
          .select('id, owner_id, view_count')
          .is('is_public', true)
          .overlaps('categories', topCategories)
          .neq('owner_id', userId)
          .order('view_count', { ascending: false })
          .limit(40);

        if (Array.isArray(catFiles)) {
          catFiles.forEach((f: any, i: number) => {
            if (likedFileIds.has(f.id) || watchedIds.has(f.id)) return;
            addRec(f.id, f.owner_id, 95 - i * 0.8, 'Matches your interests');
          });
        }
      }

      // 4) Creator affinity  more from creators the user likes
      if (preferredCreators.size > 0) {
        const creatorIds = [...preferredCreators].slice(0, 10);
        const { data: creatorFiles } = await db
          .from('files')
          .select('id, owner_id, view_count')
          .is('is_public', true)
          .in('owner_id', creatorIds)
          .order('created_at', { ascending: false })
          .limit(30);

        if (Array.isArray(creatorFiles)) {
          creatorFiles.forEach((f: any, i: number) => {
            if (likedFileIds.has(f.id) || watchedIds.has(f.id)) return;
            addRec(f.id, f.owner_id, 80 - i * 0.7, 'From a creator you enjoy');
          });
        }
      }

      // 5) Trending backfill  discovery for content the user hasn't engaged with
      const { data: trending } = await db
        .from('files')
        .select('id, owner_id')
        .is('is_public', true)
        .neq('owner_id', userId)
        .order('view_count', { ascending: false })
        .limit(60);

      if (Array.isArray(trending)) {
        trending.forEach((f: any, i: number) => {
          if (watchedIds.has(f.id)) return;
          addRec(f.id, f.owner_id, 50 - i * 0.5, 'Trending');
        });
      }

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
