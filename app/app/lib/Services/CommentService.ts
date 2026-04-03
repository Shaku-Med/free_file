import db from '../Database/supabase';
import { stripCommentImageGithubRepoForClient } from '../githubStorage';

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
  like_count?: number;
  user_has_liked?: boolean;
  gif_id?: string | null;
  gif_url?: string | null;
  gif_preview_url?: string | null;
  image_url?: string | null;
  image_type?: string | null;
  /** File owner moderation; only visible to the file owner in the API response */
  is_hidden?: boolean;
}

export interface CreateCommentInput {
  fileId: string;
  content: string;
  parentId?: string | null;
  gif?: { id: string; url: string; previewUrl: string } | null;
  image?: { url: string; type: string } | null;
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

/** IDs of comments hidden by owner or under a hidden ancestor (for non-owner viewers). */
function effectivelyHiddenCommentIds(
  rows: Array<{ id: string; parent_id: string | null; is_hidden: boolean }>
): Set<string> {
  const hidden = new Set<string>();
  for (const r of rows) {
    if (r.is_hidden) hidden.add(r.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows) {
      if (r.parent_id && hidden.has(r.parent_id) && !hidden.has(r.id)) {
        hidden.add(r.id);
        changed = true;
      }
    }
  }
  return hidden;
}

const COMMENT_SELECT_BASE =
  'id, user_id, file_id, content, parent_id, created_at, updated_at, is_edited, is_deleted, gif_id, gif_url, gif_preview_url, image_url, image_type, image_github_repo';

function isMissingImageGithubRepoColumnError(err: { message?: string; details?: string; hint?: string } | null): boolean {
  if (!err) return false;
  const text = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase();
  return text.includes('image_github_repo');
}

function isMissingIsHiddenColumnError(err: { message?: string; details?: string; hint?: string } | null): boolean {
  if (!err) return false;
  const text = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase();
  return text.includes('is_hidden');
}

/** Apply repo from Go webhook staging table (or GITHUB_REPO) after comment insert. */
async function mergePendingCommentImageRepo(commentId: string, imagePath: string): Promise<void> {
  if (!db) return;
  const path = imagePath.trim();
  if (!path) return;

  const { data: pending, error: pendErr } = await db
    .from('comment_image_upload_repos')
    .select('github_repo')
    .eq('storage_path', path)
    .maybeSingle();

  if (pendErr) {
    const msg = `${pendErr.message || ''} ${(pendErr as { code?: string }).code || ''}`.toLowerCase();
    if (msg.includes('comment_image_upload_repos') || msg.includes('does not exist')) {
      console.warn('[comments] comment_image_upload_repos missing — run migration add_comment_image_upload_repos.sql');
    }
  }

  let repo = typeof pending?.github_repo === 'string' ? pending.github_repo.trim() : '';
  if (!repo) {
    repo = process.env.GITHUB_REPO?.trim() || '';
  }
  if (repo) {
    await db.from('comments').update({ image_github_repo: repo }).eq('id', commentId);
  }
  if (pending) {
    await db.from('comment_image_upload_repos').delete().eq('storage_path', path);
  }
}

/** DB / merged rows include `image_github_repo`; public `Comment` does not. */
function commentForApiResponse(row: Record<string, unknown>): Comment {
  return stripCommentImageGithubRepoForClient(row) as unknown as Comment;
}

function stripCommentBranchForApi(c: Comment): Comment {
  const stripped = commentForApiResponse({ ...(c as unknown as Record<string, unknown>) });
  if (c.replies?.length) {
    return { ...stripped, replies: c.replies.map(stripCommentBranchForApi) };
  }
  return stripped;
}

export class CommentService {
  /**
   * Fetches all comments (including nested) via get_comments RPC, builds tree, returns total count.
   */
  async getCommentsByFileId(fileId: string, limit: number = 50, offset: number = 0): Promise<CommentServiceResponse<Comment[]>> {
    const result = await this.getCommentsTreeByFileId(fileId, limit, offset);
    if (result.error || !result.data) return { data: null, error: result.error };
    return { data: result.data.data, error: null };
  }

  /**
   * Fetches ALL comments for a file from the table, builds tree in JS, attaches like counts and user_has_liked,
   * sorts roots by like_count DESC then reply_count DESC then created_at DESC (Instagram-style), then applies limit/offset.
   */
  async getCommentsTreeByFileId(
    fileId: string,
    limit: number = 50,
    offset: number = 0,
    currentUserId?: string | null,
    /** When set (e.g. from notification deep link), ensure this comment's root thread is in the first page. */
    focusCommentId?: string | null
  ): Promise<CommentServiceResponse<CommentsTreeResult>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const maxComments = 500;
      let rows: unknown[] | null = null;
      let fetchError = null as { message?: string; details?: string; hint?: string } | null;

      const COMMENT_WITHOUT_IMAGE_REPO =
        'id, user_id, file_id, content, parent_id, created_at, updated_at, is_edited, is_deleted, gif_id, gif_url, gif_preview_url, image_url, image_type';

      let selectIncludesImageRepo = true;
      let resFull = await db
        .from('comments')
        .select(`${COMMENT_SELECT_BASE}, is_hidden`)
        .eq('file_id', fileId)
        .eq('is_deleted', false)
        .limit(maxComments);

      if (resFull.error && isMissingImageGithubRepoColumnError(resFull.error)) {
        selectIncludesImageRepo = false;
        resFull = await db
          .from('comments')
          .select(`${COMMENT_WITHOUT_IMAGE_REPO}, is_hidden`)
          .eq('file_id', fileId)
          .eq('is_deleted', false)
          .limit(maxComments);
      }

      if (resFull.error && isMissingIsHiddenColumnError(resFull.error)) {
        const cols = selectIncludesImageRepo ? COMMENT_SELECT_BASE : COMMENT_WITHOUT_IMAGE_REPO;
        resFull = await db
          .from('comments')
          .select(cols)
          .eq('file_id', fileId)
          .eq('is_deleted', false)
          .limit(maxComments);
      }

      rows = resFull.data;
      fetchError = resFull.error;

      if (fetchError) {
        console.error('Error fetching comments:', fetchError);
        return { data: null, error: 'Failed to fetch comments' };
      }

      const rawList = (rows || []) as Array<{
        id: string;
        user_id: string;
        file_id: string;
        content: string;
        parent_id: string | null;
        created_at: string;
        updated_at: string;
        is_edited: boolean;
        is_deleted: boolean;
        is_hidden?: boolean;
        gif_id?: string | null;
        gif_url?: string | null;
        gif_preview_url?: string | null;
        image_url?: string | null;
        image_type?: string | null;
        image_github_repo?: string | null;
      }>;

      const { data: ownerFile } = await db.from('files').select('owner_id').eq('id', fileId).maybeSingle();
      const fileOwnerId = ownerFile?.owner_id as string | undefined;
      const viewerIsFileOwner = Boolean(currentUserId && fileOwnerId && currentUserId === fileOwnerId);

      let list = rawList;
      if (!viewerIsFileOwner && rawList.length > 0) {
        const hiddenIds = effectivelyHiddenCommentIds(
          rawList.map((r) => ({
            id: r.id,
            parent_id: r.parent_id,
            is_hidden: Boolean(r.is_hidden),
          }))
        );
        list = rawList.filter((r) => !hiddenIds.has(r.id));
      }

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

      const commentIds = list.map((r) => r.id);
      const likeCountByComment = new Map<string, number>();
      const userLikedCommentIds = new Set<string>();
      if (commentIds.length > 0) {
        const { data: likeRows } = await db
          .from('comment_likes')
          .select('comment_id, user_id')
          .in('comment_id', commentIds);
        const likes = likeRows || [];
        for (const like of likes) {
          const cid = like.comment_id;
          likeCountByComment.set(cid, (likeCountByComment.get(cid) || 0) + 1);
          if (currentUserId && like.user_id === currentUserId) userLikedCommentIds.add(cid);
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
          content: row.content ?? '',
          parent_id: row.parent_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_edited: row.is_edited,
          is_deleted: row.is_deleted ?? false,
          user: user ?? undefined,
          replies: [],
          reply_count: 0,
          like_count: likeCountByComment.get(row.id) || 0,
          user_has_liked: userLikedCommentIds.has(row.id),
          gif_id: row.gif_id ?? undefined,
          gif_url: row.gif_url ?? undefined,
          gif_preview_url: row.gif_preview_url ?? undefined,
          image_url: row.image_url ?? undefined,
          image_type: row.image_type ?? undefined,
          ...(viewerIsFileOwner ? { is_hidden: Boolean(row.is_hidden) } : {}),
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

      roots.sort((a, b) => {
        const likesA = a.like_count ?? 0, likesB = b.like_count ?? 0;
        if (likesB !== likesA) return likesB - likesA;
        const repliesA = a.reply_count ?? 0, repliesB = b.reply_count ?? 0;
        if (repliesB !== repliesA) return repliesB - repliesA;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      for (const r of byId.values()) {
        if (r.replies?.length) {
          r.replies.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        }
      }

      let orderedRoots = roots;
      if (focusCommentId && byId.has(focusCommentId)) {
        let node = byId.get(focusCommentId)!;
        while (node.parent_id) {
          const p = byId.get(node.parent_id);
          if (!p) break;
          node = p;
        }
        const rootNode = node;
        const ri = roots.findIndex((r) => r.id === rootNode.id);
        if (ri > 0) {
          orderedRoots = [roots[ri]!, ...roots.filter((_, i) => i !== ri)];
        }
      }

      const paginatedRoots = orderedRoots
        .slice(offset, offset + limit)
        .map(stripCommentBranchForApi);

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
            return commentForApiResponse({
              ...reply,
              user: null,
            } as Record<string, unknown>);
          }

          return commentForApiResponse({
            ...reply,
            user: userData,
          } as Record<string, unknown>);
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

      const hasText = input.content != null && input.content.trim().length > 0;
      const hasGif = input.gif != null && input.gif.id && input.gif.url;
      const hasImage = input.image != null && input.image.url;
      if (!hasText && !hasGif && !hasImage) {
        return { data: null, error: 'Comment must have text, a GIF, or an image' };
      }
      if (hasText && input.content!.length > 2000) {
        return { data: null, error: 'Comment content exceeds maximum length' };
      }

      const payload: Record<string, unknown> = {
        user_id: userId,
        file_id: input.fileId,
        content: hasText ? input.content!.trim() : '',
        parent_id: input.parentId || null,
      };
      if (hasGif) {
        payload.gif_id = input.gif!.id;
        payload.gif_url = input.gif!.url;
        payload.gif_preview_url = input.gif!.previewUrl || input.gif!.url;
      }
      if (hasImage) {
        payload.image_url = input.image!.url;
        payload.image_type = input.image!.type || 'image/jpeg';
      }

      const { data: insertedData, error: insertError } = await db
        .from('comments')
        .insert([payload])
        .select('*')
        .single();

      if (insertError || !insertedData) {
        if (insertError) console.error('createComment insert:', insertError);
        return { data: null, error: 'Failed to create comment' };
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

      if (hasImage && input.image?.url && insertedData?.id) {
        try {
          await mergePendingCommentImageRepo(String(insertedData.id), input.image.url);
        } catch (e) {
          console.warn('[createComment] mergePendingCommentImageRepo:', e);
        }
      }

      const { data: finalRow } = await db
        .from('comments')
        .select('*')
        .eq('id', insertedData.id)
        .maybeSingle();

      const commentData = commentForApiResponse({
        ...(finalRow || insertedData),
        user: userData,
      } as Record<string, unknown>);

      return { data: commentData, error: null };
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
        if (updateError) console.error('updateComment update:', updateError);
        return { data: null, error: 'Failed to update comment' };
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

      const data = commentForApiResponse({
        ...updatedData,
        user: userData,
      } as Record<string, unknown>);

      return { data, error: null };
    } catch (error) {
      console.error('Error in updateComment:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  /**
   * Delete a comment. Allowed for the comment author OR the file owner.
   * When a parent comment is deleted, all nested replies are also deleted.
   */
  async deleteComment(userId: string, commentId: string): Promise<CommentServiceResponse<boolean>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data: existingComment } = await db
        .from('comments')
        .select('user_id, file_id')
        .eq('id', commentId)
        .eq('is_deleted', false)
        .single();

      if (!existingComment) {
        return { data: null, error: 'Comment not found' };
      }

      // Check: user is either the comment author or the file owner
      const isCommentAuthor = existingComment.user_id === userId;
      let isFileOwner = false;
      if (!isCommentAuthor) {
        const { data: fileRow } = await db
          .from('files')
          .select('owner_id')
          .eq('id', existingComment.file_id)
          .single();
        isFileOwner = fileRow?.owner_id === userId;
      }

      if (!isCommentAuthor && !isFileOwner) {
        return { data: null, error: 'Unauthorized' };
      }

      // Soft-delete this comment and all nested replies recursively
      const { error } = await db.rpc('delete_comment_cascade', {
        p_comment_id: commentId,
      });

      if (error) {
        // Fallback: just delete the single comment if RPC doesn't exist yet
        if (error.code === 'PGRST202') {
          const { error: fallbackError } = await db
            .from('comments')
            .update({ is_deleted: true })
            .eq('id', commentId);
          if (fallbackError) {
            console.error('Error deleting comment:', fallbackError);
            return { data: null, error: 'Failed to delete comment' };
          }
        } else {
          console.error('Error deleting comment cascade:', error);
          return { data: null, error: 'Failed to delete comment' };
        }
      }

      return { data: true, error: null };
    } catch (error) {
      console.error('Error in deleteComment:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  /**
   * Hide/unhide a comment. Only the file owner can do this.
   */
  async hideComment(userId: string, commentId: string, hidden: boolean): Promise<CommentServiceResponse<boolean>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data: existingComment } = await db
        .from('comments')
        .select('file_id')
        .eq('id', commentId)
        .eq('is_deleted', false)
        .single();

      if (!existingComment) {
        return { data: null, error: 'Comment not found' };
      }

      const { data: fileRow } = await db
        .from('files')
        .select('owner_id')
        .eq('id', existingComment.file_id)
        .single();

      if (fileRow?.owner_id !== userId) {
        return { data: null, error: 'Only the file owner can hide comments' };
      }

      const { error } = await db
        .from('comments')
        .update({ is_hidden: hidden })
        .eq('id', commentId);

      if (error) {
        console.error('Error hiding comment:', error);
        return { data: null, error: 'Failed to hide comment' };
      }

      return { data: true, error: null };
    } catch (error) {
      console.error('Error in hideComment:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  async getCommentsCount(
    fileId: string,
    viewerUserId?: string | null
  ): Promise<CommentServiceResponse<number>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data: ownerFile } = await db.from('files').select('owner_id').eq('id', fileId).maybeSingle();
      const fileOwnerId = ownerFile?.owner_id as string | undefined;
      const viewerIsFileOwner = Boolean(viewerUserId && fileOwnerId && viewerUserId === fileOwnerId);

      if (viewerIsFileOwner) {
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
      }

      const resHidden = await db
        .from('comments')
        .select('id, parent_id, is_hidden')
        .eq('file_id', fileId)
        .eq('is_deleted', false)
        .limit(5000);

      if (resHidden.error && isMissingIsHiddenColumnError(resHidden.error)) {
        const { count, error: cErr } = await db
          .from('comments')
          .select('*', { count: 'exact', head: true })
          .eq('file_id', fileId)
          .eq('is_deleted', false);
        if (cErr) {
          console.error('Error counting comments:', cErr);
          return { data: null, error: 'Failed to count comments' };
        }
        return { data: count || 0, error: null };
      }

      if (resHidden.error) {
        console.error('Error counting comments:', resHidden.error);
        return { data: null, error: 'Failed to count comments' };
      }

      const list = (resHidden.data || []) as Array<{ id: string; parent_id: string | null; is_hidden?: boolean }>;
      const hiddenIds = effectivelyHiddenCommentIds(
        list.map((r) => ({ id: r.id, parent_id: r.parent_id, is_hidden: Boolean(r.is_hidden) }))
      );
      const visible = list.filter((r) => !hiddenIds.has(r.id)).length;
      return { data: visible, error: null };
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

