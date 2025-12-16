import db from '../Database/supabase';

export interface Comment {
  id: string;
  user_id: string;
  file_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  is_edited: boolean;
  is_deleted: boolean;
  user?: {
    id: string;
    username: string;
    profile_pic: string;
  };
  replies?: Comment[];
  reply_count?: number;
}

export interface CreateCommentInput {
  fileId: string;
  content: string;
  parentId?: string | null;
}

export interface CommentServiceResponse<T> {
  data: T | null;
  error: string | null;
}

export class CommentService {
  async getCommentsByFileId(fileId: string, limit: number = 50, offset: number = 0): Promise<CommentServiceResponse<Comment[]>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data: commentsData, error } = await db
        .from('comments')
        .select('*')
        .eq('file_id', fileId)
        .eq('is_deleted', false)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Error fetching comments:', error);
        return { data: null, error: 'Failed to fetch comments' };
      }

      const commentsWithUsers = await Promise.all(
        (commentsData || []).map(async (comment: any) => {
          const { data: userData, error: userError } = await db
            .from('users')
            .select('id, username, profile_pic')
            .eq('id', comment.user_id)
            .maybeSingle();

          if (userError || !userData) {
            console.error(`Error fetching user for comment ${comment.id}:`, userError);
            return {
              ...comment,
              user: null
            };
          }

          return {
            ...comment,
            user: userData
          };
        })
      );

      const data = commentsWithUsers;

      if (error) {
        console.error('Error fetching comments:', error);
        return { data: null, error: 'Failed to fetch comments' };
      }

      const comments = await this.enrichCommentsWithReplies(data || []);
      return { data: comments, error: null };
    } catch (error) {
      console.error('Error in getCommentsByFileId:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  async getRepliesByParentId(parentId: string): Promise<CommentServiceResponse<Comment[]>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data: repliesData, error } = await db
        .from('comments')
        .select('*')
        .eq('parent_id', parentId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) {
        console.error('Error fetching replies:', error);
        return { data: null, error: 'Failed to fetch replies' };
      }

      const repliesWithUsers = await Promise.all(
        (repliesData || []).map(async (reply: any) => {
          const { data: userData, error: userError } = await db
            .from('users')
            .select('id, username, profile_pic')
            .eq('id', reply.user_id)
            .maybeSingle();

          if (userError || !userData) {
            console.error(`Error fetching user for reply ${reply.id}:`, userError);
            return {
              ...reply,
              user: null
            };
          }

          return {
            ...reply,
            user: userData
          };
        })
      );

      const data = repliesWithUsers;

      if (error) {
        console.error('Error fetching replies:', error);
        return { data: null, error: 'Failed to fetch replies' };
      }

      return { data: data || [], error: null };
    } catch (error) {
      console.error('Error in getRepliesByParentId:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  async createComment(userId: string, input: CreateCommentInput): Promise<CommentServiceResponse<Comment>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      if (!input.content || input.content.trim().length === 0) {
        return { data: null, error: 'Comment content cannot be empty' };
      }

      if (input.content.length > 2000) {
        return { data: null, error: 'Comment content exceeds maximum length' };
      }

      const { data: insertedData, error: insertError } = await db
        .from('comments')
        .insert([{
          user_id: userId,
          file_id: input.fileId,
          content: input.content.trim(),
          parent_id: input.parentId || null
        }])
        .select('*')
        .single();

      if (insertError || !insertedData) {
        return { data: null, error: insertError?.message || 'Failed to create comment' };
      }

      const { data: userData, error: userError } = await db
        .from('users')
        .select('id, username, profile_pic')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !userData) {
        console.error(`Error fetching user for new comment:`, userError);
        return { data: null, error: 'Failed to fetch user data' };
      }

      const commentData = {
        ...insertedData,
        user: userData
      };

      return { data: commentData as Comment, error: null };
    } catch (error) {
      console.error('Error in createComment:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  async updateComment(userId: string, commentId: string, content: string): Promise<CommentServiceResponse<Comment>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      if (!content || content.trim().length === 0) {
        return { data: null, error: 'Comment content cannot be empty' };
      }

      if (content.length > 2000) {
        return { data: null, error: 'Comment content exceeds maximum length' };
      }

      const { data: existingComment } = await db
        .from('comments')
        .select('user_id')
        .eq('id', commentId)
        .eq('is_deleted', false)
        .single();

      if (!existingComment) {
        return { data: null, error: 'Comment not found' };
      }

      if (existingComment.user_id !== userId) {
        return { data: null, error: 'Unauthorized' };
      }

      const { data: updatedData, error: updateError } = await db
        .from('comments')
        .update({
          content: content.trim(),
          is_edited: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', commentId)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (updateError || !updatedData) {
        return { data: null, error: updateError?.message || 'Failed to update comment' };
      }

      const { data: userData, error: userError } = await db
        .from('users')
        .select('id, username, profile_pic')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !userData) {
        console.error(`Error fetching user for updated comment:`, userError);
        return { data: null, error: 'Failed to fetch user data' };
      }

      const data = {
        ...updatedData,
        user: userData
      };

      return { data: data as Comment, error: null };
    } catch (error) {
      console.error('Error in updateComment:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  async deleteComment(userId: string, commentId: string): Promise<CommentServiceResponse<boolean>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data: existingComment } = await db
        .from('comments')
        .select('user_id')
        .eq('id', commentId)
        .eq('is_deleted', false)
        .single();

      if (!existingComment) {
        return { data: null, error: 'Comment not found' };
      }

      if (existingComment.user_id !== userId) {
        return { data: null, error: 'Unauthorized' };
      }

      const { error } = await db
        .from('comments')
        .update({ is_deleted: true })
        .eq('id', commentId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error deleting comment:', error);
        return { data: null, error: 'Failed to delete comment' };
      }

      return { data: true, error: null };
    } catch (error) {
      console.error('Error in deleteComment:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  async getCommentsCount(fileId: string): Promise<CommentServiceResponse<number>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { count, error } = await db
        .from('comments')
        .select('*', { count: 'exact', head: true })
        .eq('file_id', fileId)
        .eq('is_deleted', false);

      if (error) {
        console.error('Error counting comments:', error);
        return { data: null, error: 'Failed to count comments' };
      }

      return { data: count || 0, error: null };
    } catch (error) {
      console.error('Error in getCommentsCount:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  private async enrichCommentsWithReplies(comments: any[]): Promise<Comment[]> {
    const enrichedComments = await Promise.all(
      comments.map(async (comment) => {
        const repliesResponse = await this.getRepliesByParentId(comment.id);
        // User data is already set in commentsWithUsers, so we use comment.user
        return {
          ...comment,
          user: comment.user || null,
          replies: repliesResponse.data || [],
          reply_count: repliesResponse.data?.length || 0
        } as Comment;
      })
    );

    return enrichedComments;
  }
}

export const commentService = new CommentService();

