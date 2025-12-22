import db from '../Database/supabase';

export interface TrendingContentRecord {
  id?: string;
  file_id: string;
  trending_score: number;
  time_window: string;
  computed_at?: string;
}

export interface TrendingQueryParams {
  timeWindow?: string;
  limit?: number;
  offset?: number;
  minScore?: number;
}

export interface TrendingResponse {
  data: TrendingContentRecord[] | null;
  error: string | null;
}

export type TimeWindow = '1h' | '24h' | '7d' | '30d' | 'all';

/**
 * Service for managing trending content
 * Follows Single Responsibility Principle - only handles trending content operations
 */
export class TrendingContentService {
  /**
   * Get trending content for a specific time window
   */
  async getTrendingContent(params: TrendingQueryParams = {}): Promise<TrendingResponse> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const timeWindow = params.timeWindow || '24h';

      let query = db
        .from('trending_content')
        .select('*')
        .eq('time_window', timeWindow)
        .order('trending_score', { ascending: false });

      if (params.minScore !== undefined) {
        query = query.gte('trending_score', params.minScore);
      }

      if (params.limit) {
        query = query.limit(params.limit);
      }

      if (params.offset) {
        query = query.range(params.offset, params.offset + (params.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching trending content:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Exception in getTrendingContent:', error);
      return { data: null, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Compute trending scores for a specific time window
   */
  async computeTrendingContent(timeWindow: TimeWindow = '24h'): Promise<TrendingResponse> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      // Calculate time threshold based on window
      const now = new Date();
      let thresholdDate: Date;

      switch (timeWindow) {
        case '1h':
          thresholdDate = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          thresholdDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          thresholdDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          thresholdDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'all':
          thresholdDate = new Date(0); // Beginning of time
          break;
        default:
          thresholdDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }

      // Get files with engagement metrics within the time window
      const { data: files, error: filesError } = await db
        .from('files')
        .select('id, view_count, share_count, up_count, created_at')
        .is('is_public', true)
        .gte('created_at', thresholdDate.toISOString())
        .limit(1000);

      if (filesError) {
        return { data: null, error: filesError.message };
      }

      if (!files || files.length === 0) {
        return { data: [], error: null };
      }

      // Calculate trending scores
      // Formula: (views * 1) + (shares * 3) + (up_count * 2) - (time decay)
      const trendingRecords: Omit<TrendingContentRecord, 'id' | 'computed_at'>[] = [];

      files.forEach((file: any) => {
        const views = Number(file.view_count || 0);
        const shares = Number(file.share_count || 0);
        const upCount = Number(file.up_count || 0);
        const createdAt = new Date(file.created_at);
        const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

        // Time decay factor (newer content gets boost)
        const timeDecay = Math.max(0.1, 1 - (hoursSinceCreation / (24 * 7))); // Decay over 7 days

        // Calculate trending score
        const baseScore = views * 1 + shares * 3 + upCount * 2;
        const trendingScore = baseScore * timeDecay;

        trendingRecords.push({
          file_id: file.id,
          trending_score: Math.round(trendingScore * 100) / 100,
          time_window: timeWindow,
        });
      });

      // Sort by score and take top 100
      trendingRecords.sort((a, b) => b.trending_score - a.trending_score);
      const topTrending = trendingRecords.slice(0, 100);

      // Store trending content
      if (topTrending.length > 0) {
        const now = new Date().toISOString();
        const recordsWithTimestamp = topTrending.map(rec => ({
          ...rec,
          computed_at: now,
        }));

        const { data, error } = await db
          .from('trending_content')
          .upsert(recordsWithTimestamp, {
            onConflict: 'file_id,time_window',
            ignoreDuplicates: false,
          })
          .select();

        if (error) {
          console.error('Error storing trending content:', error);
          return { data: null, error: error.message };
        }

        return { data, error: null };
      }

      return { data: [], error: null };
    } catch (error) {
      console.error('Exception in computeTrendingContent:', error);
      return { data: null, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Refresh trending content for all time windows
   */
  async refreshAllTrendingContent(): Promise<{ success: boolean; error: string | null }> {
    try {
      const timeWindows: TimeWindow[] = ['1h', '24h', '7d', '30d', 'all'];

      for (const window of timeWindows) {
        const result = await this.computeTrendingContent(window);
        if (result.error) {
          console.error(`Error computing trending for ${window}:`, result.error);
          // Continue with other windows even if one fails
        }
      }

      return { success: true, error: null };
    } catch (error) {
      console.error('Exception in refreshAllTrendingContent:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get file IDs from trending content
   */
  async getTrendingFileIds(params: TrendingQueryParams = {}): Promise<string[]> {
    try {
      const result = await this.getTrendingContent(params);
      if (result.error || !result.data) {
        return [];
      }

      return result.data.map(record => record.file_id);
    } catch (error) {
      console.error('Exception in getTrendingFileIds:', error);
      return [];
    }
  }
}

export const trendingContentService = new TrendingContentService();
