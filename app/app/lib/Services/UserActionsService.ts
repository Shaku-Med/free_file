import db from '../Database/supabase';

export interface UserActionsMap {
  likedFileIds: Set<string>;
  dislikedFileIds: Set<string>;
}

export class UserActionsService {
  /**
   * Fetches all likes and dislikes for a user in one query
   */
  async getUserActions(userId: string, fileIds: string[]): Promise<UserActionsMap> {
    try {
      if (!db || !userId || fileIds.length === 0) {
        return {
          likedFileIds: new Set(),
          dislikedFileIds: new Set()
        };
      }

      // Fetch all likes and dislikes in parallel
      const [likesResult, dislikesResult] = await Promise.all([
        db
          .from('likes')
          .select('file_id')
          .eq('user_id', userId)
          .in('file_id', fileIds),
        db
          .from('dislike')
          .select('file_id')
          .eq('user_id', userId)
          .in('file_id', fileIds)
      ]);

      const likedFileIds = new Set(
        (likesResult.data || []).map((like: any) => like.file_id)
      );
      const dislikedFileIds = new Set(
        (dislikesResult.data || []).map((dislike: any) => dislike.file_id)
      );

      return {
        likedFileIds,
        dislikedFileIds
      };
    } catch (error) {
      console.error('Error fetching user actions:', error);
      return {
        likedFileIds: new Set(),
        dislikedFileIds: new Set()
      };
    }
  }
}

export const userActionsService = new UserActionsService();

