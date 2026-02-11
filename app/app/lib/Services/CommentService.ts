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

/** Result of getCommentsByFileId when using tree: includes totalCount for display */
export interface CommentsTreeResult {
  data: Comment[];
  totalCount: number;
}

export class CommentService {
  /**
   * Fetches all comments (including nested) via get_comments RPC, builds tree, returns total count.
   */
  async getCommentsByFileId(fileId: string, limit: number = 50, offset: number = 0): Promise<CommentServiceResponse<Comment[]>> {
    const result = await this.getCommentsTreeByFileId(fileId, limit, offset);
    if (result.error || !result.data) return { data: result.data, error: result.error };
    return { data: result.data.data, error: null };
  }

  /**
   * Fetches ALL comments for a file from the table, builds tree in JS, then applies limit/offset to roots.
   * This guarantees we see every comment; the RPC can sometimes return partial results.
   */
  async getCommentsTreeByFileId(
    fileId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<CommentServiceResponse<CommentsTreeResult>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const maxComments = 500;
      const { data: rows, error } = await db
        .from('comments')
        .select('id, user_id, file_id, content, parent_id, created_at, updated_at, is_edited, is_deleted')
        .eq('file_id', fileId)
        .eq('is_deleted', false)
        .limit(maxComments);

      if (error) {
        console.error('Error fetching comments:', error);
        return { data: null, error: 'Failed to fetch comments' };
      }

      const list = (rows || []) as Array<{
        id: string;
        user_id: string;
        file_id: string;
        content: string;
        parent_id: string | null;
        created_at: string;
        updated_at: string;
        is_edited: boolean;
        is_deleted: boolean;
      }>;

      const totalCount = list.length;
      const userIds = [...new Set(list.map((r) => r.user_id))];
      const userMap = new Map<string, { id: string; username: string; profile_pic: string }>();
      if (userIds.length > 0) {
        const { data: userRows } = await db
          .from('users')
          .select('id, username, profile_pic')
          .in('id', userIds);
        for (const u of userRows || []) {
          userMap.set(u.id, {
            id: u.id,
            username: (u as any).username ?? '',
            profile_pic: (u as any).profile_pic ?? '',
          });
        }
      }

      const byId = new Map<string, Comment>();
      const roots: Comment[] = [];

      for (const row of list) {
        const user = userMap.get(row.user_id);
        const comment: Comment = {
          id: row.id,
          user_id: row.user_id,
          file_id: row.file_id,
          content: row.content,
          parent_id: row.parent_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_edited: row.is_edited,
          is_deleted: row.is_deleted ?? false,
          user: user ?? undefined,
          replies: [],
          reply_count: 0,
        };
        byId.set(row.id, comment);
      }

      for (const row of list) {
        const comment = byId.get(row.id)!;
        if (row.parent_id == null) {
          roots.push(comment);
        } else {
          const parent = byId.get(row.parent_id);
          if (parent) {
            parent.replies = parent.replies ?? [];
            parent.replies.push(comment);
            parent.reply_count = parent.replies.length;
          } else {
            roots.push(comment);
          }
        }
      }

      roots.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      for (const r of byId.values()) {
        if (r.replies?.length) {
          r.replies.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        }
      }

      const paginatedRoots = roots.slice(offset, offset + limit);

      return {
        data: { data: paginatedRoots, totalCount },
        error: null,
      };
    } catch (error) {
      console.error('Error in getCommentsTreeByFileId:', error);
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

