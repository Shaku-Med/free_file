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
  /** Creator pinned this comment to the top of the thread (one per file). */
  is_pinned?: boolean;
}

export interface CreateCommentInput {
  fileId: string;
  content: string;
  parentId?: string | null;
  gif?: { id: string; url: string; previewUrl: string } | null;
  image?: { url: string; type: string } | null;
  /** Playback position when the comment was written, for slider markers. */
  timestampSeconds?: number | null;
}

export interface CommentServiceResponse<T> {
  data: T | null;
  error: string | null;
}

/** Result of getCommentsTreeByFileId when using tree: includes totalCount for display */
export interface CommentsTreeResult {
  data: Comment[];
  /** Top-level threads only (pagination unit). */
  totalCount: number;
  /** All visible comments including nested replies. */
  totalCommentCount: number;
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

const COMMENT_SELECT_WITHOUT_IMAGE_REPO =
  'id, user_id, file_id, content, parent_id, created_at, updated_at, is_edited, is_deleted, gif_id, gif_url, gif_preview_url, image_url, image_type';

/** Hard ceiling on thread depth / descendant walks so a crafted parent chain can never loop the server. */
const MAX_THREAD_DEPTH = 30;
const MAX_DESCENDANT_ROWS = 5000;

/**
 * Above this many rows the file switches from the in-memory "top comments"
 * path to SQL pagination (comments_scale_pagination.sql RPCs): newest-first
 * pages straight off an index, so 1k or 100k comments cost the same per page.
 */
const IN_MEMORY_COMMENT_LIMIT = 500;

/** Missing-RPC error from PostgREST — the migration isn't deployed yet. */
function isMissingRpcError(err: { code?: string } | null): boolean {
  return err?.code === 'PGRST202';
}

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
    .select('github_repo, storage_backend')
    .eq('storage_path', path)
    .maybeSingle();

  if (pendErr) {
    const msg = `${pendErr.message || ''} ${(pendErr as { code?: string }).code || ''}`.toLowerCase();
    if (msg.includes('comment_image_upload_repos') || msg.includes('does not exist')) {
      console.warn('[comments] comment_image_upload_repos missing  run migration add_comment_image_upload_repos.sql');
    }
  }

  const backend = (pending as { storage_backend?: string | null } | null)?.storage_backend === 'r2' ? 'r2' : 'github';
  const update: Record<string, unknown> = { storage_backend: backend };
  if (backend === 'github') {
    let repo = typeof pending?.github_repo === 'string' ? pending.github_repo.trim() : '';
    if (!repo) {
      repo = process.env.GITHUB_REPO?.trim() || '';
    }
    if (repo) update.image_github_repo = repo;
  }
  await db.from('comments').update(update).eq('id', commentId);
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
   * Direct replies to one comment, paginated. Backs the "View N replies"
   * expander so a thread is only ever fetched when someone opens it.
   *
   * `fileId` is required and checked against the parent row. The caller has
   * already proved it may read that file, so without this a valid fileId could
   * be paired with any commentId to pull a thread off a file the viewer cannot
   * see.
   */
  async getRepliesByCommentId(
    fileId: string,
    parentId: string,
    limit: number = 20,
    offset: number = 0,
    currentUserId: string | null = null
  ): Promise<CommentServiceResponse<{ data: Comment[]; totalCount: number }>> {
    try {
      if (!db) return { data: null, error: 'Database not initialized' };

      const safeLimit = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);
      const safeOffset = Math.min(Math.max(Math.trunc(offset) || 0, 0), 10_000);

      const { data: parent } = await db
        .from('comments')
        .select('id, file_id, parent_id, is_deleted')
        .eq('id', parentId)
        .maybeSingle();
      const parentRow = parent as {
        file_id?: string;
        parent_id?: string | null;
        is_deleted?: boolean;
      } | null;
      if (!parentRow || parentRow.file_id !== fileId || parentRow.is_deleted) {
        return { data: { data: [], totalCount: 0 }, error: null };
      }

      const { data: ownerFile } = await db
        .from('files')
        .select('owner_id')
        .eq('id', fileId)
        .maybeSingle();
      const viewerIsFileOwner = Boolean(
        currentUserId && ownerFile?.owner_id && currentUserId === ownerFile.owner_id
      );

      // A hidden comment hides its whole subtree from everyone but the file
      // owner. The tree endpoint never hands a hidden branch out, but this
      // endpoint takes a raw parentId, so it has to prove the branch is
      // visible itself or a guessed id reads a moderated thread.
      if (!viewerIsFileOwner) {
        const hiddenAncestor = await this.branchIsHidden(parentId, fileId);
        if (hiddenAncestor === null || hiddenAncestor) {
          return { data: { data: [], totalCount: 0 }, error: null };
        }
      }

      let hasHiddenColumn = true;
      let query = db
        .from('comments')
        .select(`${COMMENT_SELECT_BASE}, is_hidden`, { count: 'exact' })
        .eq('file_id', fileId)
        .eq('parent_id', parentId)
        .eq('is_deleted', false);
      // Filter in SQL so pagination and the exact count only ever see rows the
      // viewer is allowed to read.
      if (!viewerIsFileOwner) query = query.not('is_hidden', 'is', true);
      let res = await query
        .order('created_at', { ascending: true })
        .range(safeOffset, safeOffset + safeLimit - 1);

      if (res.error && isMissingIsHiddenColumnError(res.error)) {
        hasHiddenColumn = false;
        res = await db
          .from('comments')
          .select(COMMENT_SELECT_BASE, { count: 'exact' })
          .eq('file_id', fileId)
          .eq('parent_id', parentId)
          .eq('is_deleted', false)
          .order('created_at', { ascending: true })
          .range(safeOffset, safeOffset + safeLimit - 1);
      }

      if (res.error) {
        console.error('getRepliesByCommentId:', res.error);
        return { data: null, error: 'Failed to load replies' };
      }

      const list = (res.data ?? []) as Array<Record<string, any>>;
      const count = res.count;
      if (list.length === 0) return { data: { data: [], totalCount: count ?? 0 }, error: null };

      const userIds = [...new Set(list.map((r) => r.user_id).filter(Boolean))];
      const commentIds = list.map((r) => r.id as string);

      const [{ data: users }, { likeCount, likedByViewer }, childCount] = await Promise.all([
        db.from('users').select('id, username, profile_pic').in('id', userIds),
        this.getLikeCounts(commentIds, currentUserId),
        // Every reply carries the size of its whole subtree. Without this a
        // nested thread had no "View N replies" control and its children were
        // unreachable: the header count included them while the UI could never
        // show them.
        this.countDescendants(fileId, commentIds, viewerIsFileOwner, hasHiddenColumn),
      ]);

      const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

      const replies = list.map((row) =>
        stripCommentBranchForApi({
          id: row.id,
          user_id: row.user_id,
          file_id: row.file_id,
          content: row.content ?? '',
          parent_id: row.parent_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_edited: row.is_edited,
          is_deleted: false,
          user: userMap.get(row.user_id) ?? undefined,
          // Loaded on demand, same as the roots.
          replies: [],
          reply_count: childCount.get(row.id) ?? 0,
          like_count: likeCount.get(row.id) ?? 0,
          user_has_liked: likedByViewer.has(row.id),
          gif_id: row.gif_id ?? undefined,
          gif_url: row.gif_url ?? undefined,
          gif_preview_url: row.gif_preview_url ?? undefined,
          image_url: row.image_url ?? undefined,
          image_type: row.image_type ?? undefined,
          ...(viewerIsFileOwner && hasHiddenColumn ? { is_hidden: Boolean(row.is_hidden) } : {}),
        } as Comment)
      );

      return { data: { data: replies, totalCount: count ?? replies.length }, error: null };
    } catch (error) {
      console.error('Error in getRepliesByCommentId:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  /**
   * Whether commentId or any ancestor above it is hidden by the file owner.
   * Returns null when the chain leaves the file or a lookup fails (deny).
   */
  private async branchIsHidden(commentId: string, fileId: string): Promise<boolean | null> {
    if (!db) return null;
    let cursor: string | null = commentId;
    for (let depth = 0; cursor && depth < MAX_THREAD_DEPTH; depth++) {
      const { data, error } = await db
        .from('comments')
        .select('parent_id, is_hidden, file_id')
        .eq('id', cursor)
        .maybeSingle();
      if (error) {
        // Pre-migration schema has no is_hidden column: nothing can be hidden.
        if (isMissingIsHiddenColumnError(error)) return false;
        return null;
      }
      const row = data as { parent_id?: string | null; is_hidden?: boolean; file_id?: string } | null;
      if (!row || row.file_id !== fileId) return null;
      if (row.is_hidden) return true;
      cursor = row.parent_id ?? null;
    }
    return false;
  }

  /**
   * Size of each comment's whole reply subtree (all depths). Hidden branches
   * are skipped for non-owners so these numbers always match what the viewer
   * can actually expand. One recursive-CTE round trip when the RPC is
   * deployed; otherwise a bounded level-by-level walk.
   */
  private async countDescendants(
    fileId: string,
    rootIds: string[],
    viewerIsFileOwner: boolean,
    hasHiddenColumn: boolean
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (!db || rootIds.length === 0) return counts;

    const { data: rpcRows, error: rpcErr } = await db.rpc('get_reply_subtree_counts', {
      p_file_id: fileId,
      p_parent_ids: rootIds,
      p_include_hidden: viewerIsFileOwner,
    });
    if (!rpcErr && Array.isArray(rpcRows)) {
      for (const row of rpcRows as Array<{ parent_id: string; reply_count: number | string }>) {
        counts.set(row.parent_id, Number(row.reply_count) || 0);
      }
      return counts;
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      console.warn('get_reply_subtree_counts:', rpcErr);
    }

    const topOf = new Map<string, string>();
    for (const id of rootIds) topOf.set(id, id);

    let frontier = [...rootIds];
    let fetched = 0;
    for (let depth = 0; frontier.length > 0 && depth < MAX_THREAD_DEPTH && fetched < MAX_DESCENDANT_ROWS; depth++) {
      const cols = hasHiddenColumn ? 'id, parent_id, is_hidden' : 'id, parent_id';
      const { data, error } = await db
        .from('comments')
        .select(cols)
        .in('parent_id', frontier)
        .eq('is_deleted', false)
        .limit(MAX_DESCENDANT_ROWS);
      if (error) break;
      const rows = (data ?? []) as unknown as Array<{ id: string; parent_id: string; is_hidden?: boolean }>;
      fetched += rows.length;

      const next: string[] = [];
      for (const row of rows) {
        if (!viewerIsFileOwner && hasHiddenColumn && row.is_hidden) continue;
        const top = topOf.get(row.parent_id);
        if (!top || topOf.has(row.id)) continue;
        topOf.set(row.id, top);
        counts.set(top, (counts.get(top) ?? 0) + 1);
        next.push(row.id);
      }
      frontier = next;
    }
    return counts;
  }

  /**
   * Like count + did-the-viewer-like for a batch of comments. The RPC
   * aggregates in SQL (a comment with 100k likes costs one row, not 100k);
   * without it we fall back to counting rows, capped so a viral comment can't
   * balloon server memory.
   */
  private async getLikeCounts(
    commentIds: string[],
    currentUserId: string | null
  ): Promise<{ likeCount: Map<string, number>; likedByViewer: Set<string> }> {
    const likeCount = new Map<string, number>();
    const likedByViewer = new Set<string>();
    if (!db || commentIds.length === 0) return { likeCount, likedByViewer };

    const { data: rpcRows, error: rpcErr } = await db.rpc('get_comment_like_counts', {
      p_comment_ids: commentIds,
      p_viewer_id: currentUserId,
    });
    if (!rpcErr && Array.isArray(rpcRows)) {
      for (const row of rpcRows as Array<{ comment_id: string; like_count: number | string; viewer_liked: boolean }>) {
        likeCount.set(row.comment_id, Number(row.like_count) || 0);
        if (row.viewer_liked) likedByViewer.add(row.comment_id);
      }
      return { likeCount, likedByViewer };
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      console.warn('get_comment_like_counts:', rpcErr);
    }

    const { data: likes } = await db
      .from('comment_likes')
      .select('comment_id, user_id')
      .in('comment_id', commentIds)
      .limit(50_000);
    for (const l of (likes ?? []) as Array<{ comment_id: string; user_id: string }>) {
      likeCount.set(l.comment_id, (likeCount.get(l.comment_id) ?? 0) + 1);
      if (currentUserId && l.user_id === currentUserId) likedByViewer.add(l.comment_id);
    }
    return { likeCount, likedByViewer };
  }

  /**
   * Full comment rows for a set of ids, with the same schema-drift fallbacks
   * the tree fetch uses (image_github_repo / is_hidden may not be migrated).
   */
  private async fetchCommentRowsByIds(
    fileId: string,
    ids: string[]
  ): Promise<{ rows: Array<Record<string, any>>; hasHiddenColumn: boolean }> {
    if (!db || ids.length === 0) return { rows: [], hasHiddenColumn: true };
    let hasHiddenColumn = true;
    let includesImageRepo = true;

    let res = await db
      .from('comments')
      .select(`${COMMENT_SELECT_BASE}, is_hidden`)
      .eq('file_id', fileId)
      .eq('is_deleted', false)
      .in('id', ids);
    if (res.error && isMissingImageGithubRepoColumnError(res.error)) {
      includesImageRepo = false;
      res = await db
        .from('comments')
        .select(`${COMMENT_SELECT_WITHOUT_IMAGE_REPO}, is_hidden`)
        .eq('file_id', fileId)
        .eq('is_deleted', false)
        .in('id', ids);
    }
    if (res.error && isMissingIsHiddenColumnError(res.error)) {
      hasHiddenColumn = false;
      res = await db
        .from('comments')
        .select(includesImageRepo ? COMMENT_SELECT_BASE : COMMENT_SELECT_WITHOUT_IMAGE_REPO)
        .eq('file_id', fileId)
        .eq('is_deleted', false)
        .in('id', ids);
    }
    if (res.error) {
      console.error('fetchCommentRowsByIds:', res.error);
      return { rows: [], hasHiddenColumn };
    }
    return { rows: (res.data ?? []) as Array<Record<string, any>>, hasHiddenColumn };
  }

  /**
   * Ancestor chain of a comment, root first (ending with the comment itself).
   * Empty when the chain leaves the file, hits a deleted row, or is deeper
   * than MAX_THREAD_DEPTH — a deep link that can't resolve is simply ignored.
   */
  private async commentChainToRoot(commentId: string, fileId: string): Promise<string[]> {
    if (!db) return [];
    const chain: string[] = [];
    let cursor: string | null = commentId;
    for (let depth = 0; cursor && depth < MAX_THREAD_DEPTH; depth++) {
      const { data, error } = await db
        .from('comments')
        .select('id, parent_id, file_id, is_deleted')
        .eq('id', cursor)
        .maybeSingle();
      if (error) return [];
      const row = data as { id: string; parent_id?: string | null; file_id?: string; is_deleted?: boolean } | null;
      if (!row || row.file_id !== fileId || row.is_deleted) return [];
      chain.push(row.id);
      cursor = row.parent_id ?? null;
    }
    if (cursor) return [];
    return chain.reverse();
  }

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
  ,
    /** When false, roots come back with reply_count but no nested replies. */
    includeReplies: boolean = true
  ): Promise<CommentServiceResponse<CommentsTreeResult>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      // One cheap head count picks the strategy. Small files keep the rich
      // in-memory ordering (top comments by likes); anything bigger switches
      // to SQL pagination so a 100k-comment thread costs one indexed page per
      // request instead of the whole table in Node memory.
      const { count: totalRowCount } = await db
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('file_id', fileId)
        .eq('is_deleted', false);

      if ((totalRowCount ?? 0) > IN_MEMORY_COMMENT_LIMIT) {
        const large = await this.getCommentsPageLarge(
          fileId,
          limit,
          offset,
          currentUserId ?? null,
          focusCommentId ?? null,
          totalRowCount ?? 0
        );
        if (large) return large;
        // RPCs not deployed: fall through to the capped in-memory path so the
        // thread still works, just limited to the first rows.
      }

      const maxComments = IN_MEMORY_COMMENT_LIMIT;
      let rows: unknown[] | null = null;
      let fetchError = null as { message?: string; details?: string; hint?: string } | null;

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
          .select(`${COMMENT_SELECT_WITHOUT_IMAGE_REPO}, is_hidden`)
          .eq('file_id', fileId)
          .eq('is_deleted', false)
          .limit(maxComments);
      }

      if (resFull.error && isMissingIsHiddenColumnError(resFull.error)) {
        const cols = selectIncludesImageRepo ? COMMENT_SELECT_BASE : COMMENT_SELECT_WITHOUT_IMAGE_REPO;
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
      const { likeCount: likeCountByComment, likedByViewer: userLikedCommentIds } =
        await this.getLikeCounts(commentIds, currentUserId ?? null);

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
          } else {
            roots.push(comment);
          }
        }
      }

      // reply_count is the WHOLE subtree, not just direct children, so the
      // numbers a viewer sees add up to the file's total comment count as they
      // expand threads level by level.
      const countSubtree = (c: Comment): number => {
        let total = 0;
        for (const child of c.replies ?? []) {
          total += 1 + countSubtree(child);
        }
        c.reply_count = total;
        return total;
      };
      for (const r of roots) countSubtree(r);

      // The pinned comment (at most one per file) is fetched separately so the
      // main comment select doesn't depend on the is_pinned column existing yet.
      // Degrades silently to "no pin" if the migration hasn't run.
      try {
        const { data: pinnedRow, error: pinErr } = await db
          .from('comments')
          .select('id')
          .eq('file_id', fileId)
          .eq('is_pinned', true)
          .eq('is_deleted', false)
          .maybeSingle();
        const pinnedId = !pinErr ? (pinnedRow as { id?: string } | null)?.id : undefined;
        if (pinnedId && byId.has(pinnedId)) {
          byId.get(pinnedId)!.is_pinned = true;
        }
      } catch {
        /* is_pinned column not deployed  no pin */
      }

      // Pagination is over TOP-LEVEL comments only — replies live nested
      // inside their root. Count roots (not the whole flat list) so the
      // client's load-more matches what it actually paginates.
      const totalCount = roots.length;
      const totalCommentCount = list.length;

      roots.sort((a, b) => {
        // Pinned root always leads.
        const pinA = a.is_pinned ? 1 : 0, pinB = b.is_pinned ? 1 : 0;
        if (pinB !== pinA) return pinB - pinA;
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
        if (ri > 0 && !roots[ri]!.is_pinned) {
          const rest = roots.filter((_, i) => i !== ri);
          // Keep a pinned root at the very top; slot the focused thread right after.
          orderedRoots = rest[0]?.is_pinned
            ? [rest[0], roots[ri]!, ...rest.slice(1)]
            : [roots[ri]!, ...rest];
        }
      }

      const paginatedRoots = orderedRoots
        .slice(offset, offset + limit)
        .map(stripCommentBranchForApi)
        // Replies are fetched on demand. reply_count survives so the client can
        // render "View N replies" without holding the thread in memory, and the
        // sort above already used the real counts.
        .map((r) => (includeReplies ? r : { ...r, replies: [] }));

      return {
        data: { data: paginatedRoots, totalCount, totalCommentCount },
        error: null,
      };
    } catch (error) {
      console.error('Error in getCommentsTreeByFileId:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  /**
   * SQL-paginated page of root comments for files too big for the in-memory
   * path. Newest first (like-ranked "top comments" needs counters the schema
   * doesn't denormalize; ranking 30k roots per request would melt the DB).
   * The pinned thread and a deep-linked thread still float to the top of
   * page 0. Returns null when the pagination RPC isn't deployed so the caller
   * can fall back.
   */
  private async getCommentsPageLarge(
    fileId: string,
    limit: number,
    offset: number,
    currentUserId: string | null,
    focusCommentId: string | null,
    totalRowCount: number
  ): Promise<CommentServiceResponse<CommentsTreeResult> | null> {
    if (!db) return null;

    const { data: ownerFile } = await db.from('files').select('owner_id').eq('id', fileId).maybeSingle();
    const viewerIsFileOwner = Boolean(
      currentUserId && ownerFile?.owner_id && currentUserId === ownerFile.owner_id
    );

    const { data: pageData, error: pageErr } = await db.rpc('get_comment_roots_page', {
      p_file_id: fileId,
      p_include_hidden: viewerIsFileOwner,
      p_limit: limit,
      p_offset: offset,
    });
    if (pageErr) {
      if (!isMissingRpcError(pageErr)) console.error('get_comment_roots_page:', pageErr);
      return null;
    }

    const page = (Array.isArray(pageData) ? pageData : []) as Array<{
      comment_id: string;
      reply_count: number | string;
      total_roots: number | string;
    }>;
    const replyCountById = new Map(page.map((r) => [r.comment_id, Number(r.reply_count) || 0]));
    const pageIds = page.map((r) => r.comment_id);

    let totalRoots = page.length > 0 ? Number(page[0].total_roots) || 0 : 0;
    if (page.length === 0) {
      // Page past the end still needs the real root total for "Load more".
      let q = db
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('file_id', fileId)
        .is('parent_id', null)
        .eq('is_deleted', false);
      if (!viewerIsFileOwner) q = q.not('is_hidden', 'is', true);
      const { count } = await q;
      totalRoots = count ?? 0;
    }

    // Page-0 extras that outrank recency.
    let pinnedId: string | null = null;
    if (offset === 0) {
      try {
        const { data: pinnedRow, error: pinErr } = await db
          .from('comments')
          .select('id')
          .eq('file_id', fileId)
          .eq('is_pinned', true)
          .eq('is_deleted', false)
          .maybeSingle();
        pinnedId = !pinErr ? ((pinnedRow as { id?: string } | null)?.id ?? null) : null;
      } catch {
        /* is_pinned column not deployed — no pin */
      }
    }

    // Deep link: the focused comment's whole ancestor chain comes along so the
    // client can open the branch it lives in.
    let focusChainIds: string[] = [];
    if (offset === 0 && focusCommentId) {
      focusChainIds = await this.commentChainToRoot(focusCommentId, fileId);
      if (focusChainIds.length > 0 && !viewerIsFileOwner) {
        const hidden = await this.branchIsHidden(focusCommentId, fileId);
        if (hidden !== false) focusChainIds = [];
      }
    }
    const focusRootId = focusChainIds[0] ?? null;

    const idsToFetch = [
      ...new Set([...(pinnedId ? [pinnedId] : []), ...focusChainIds, ...pageIds]),
    ];
    const { rows, hasHiddenColumn } = await this.fetchCommentRowsByIds(fileId, idsToFetch);
    const visibleRows =
      !viewerIsFileOwner && hasHiddenColumn ? rows.filter((r) => !r.is_hidden) : rows;
    const rowById = new Map(visibleRows.map((r) => [r.id as string, r]));

    // Floated extras weren't in the page, so their subtree sizes are missing.
    const extraIds = idsToFetch.filter((id) => !replyCountById.has(id) && rowById.has(id));
    if (extraIds.length > 0) {
      const extra = await this.countDescendants(fileId, extraIds, viewerIsFileOwner, hasHiddenColumn);
      for (const [k, v] of extra) replyCountById.set(k, v);
    }

    const userIds = [...new Set(visibleRows.map((r) => r.user_id as string).filter(Boolean))];
    const [{ data: users }, { likeCount, likedByViewer }] = await Promise.all([
      userIds.length > 0
        ? db.from('users').select('id, username, profile_pic').in('id', userIds)
        : Promise.resolve({ data: [] as Array<{ id: string; username: string; profile_pic: string }> }),
      this.getLikeCounts(visibleRows.map((r) => r.id as string), currentUserId),
    ]);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    const toComment = (row: Record<string, any>): Comment => ({
      id: row.id,
      user_id: row.user_id,
      file_id: row.file_id,
      content: row.content ?? '',
      parent_id: row.parent_id ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_edited: Boolean(row.is_edited),
      is_deleted: false,
      user: userMap.get(row.user_id) ?? undefined,
      replies: [],
      reply_count: replyCountById.get(row.id) ?? 0,
      like_count: likeCount.get(row.id) ?? 0,
      user_has_liked: likedByViewer.has(row.id),
      gif_id: row.gif_id ?? undefined,
      gif_url: row.gif_url ?? undefined,
      gif_preview_url: row.gif_preview_url ?? undefined,
      image_url: row.image_url ?? undefined,
      image_type: row.image_type ?? undefined,
      image_github_repo: row.image_github_repo ?? undefined,
      ...(pinnedId && row.id === pinnedId ? { is_pinned: true } : {}),
      ...(viewerIsFileOwner && hasHiddenColumn ? { is_hidden: Boolean(row.is_hidden) } : {}),
    } as Comment);

    const commentById = new Map<string, Comment>();
    for (const row of visibleRows) commentById.set(row.id as string, toComment(row));

    // Nest the focus chain: each ancestor carries just the next link, enough
    // for the client to auto-expand down to the focused comment and lazy-load
    // the rest of each level on demand.
    for (let i = 0; i + 1 < focusChainIds.length; i++) {
      const parent = commentById.get(focusChainIds[i]);
      const child = commentById.get(focusChainIds[i + 1]);
      if (!parent || !child) break;
      parent.replies = [child];
    }

    const roots: Comment[] = [];
    const seen = new Set<string>();
    const pushRoot = (id: string | null) => {
      if (!id || seen.has(id)) return;
      const c = commentById.get(id);
      if (!c || c.parent_id != null) return;
      seen.add(id);
      roots.push(c);
    };
    pushRoot(pinnedId);
    pushRoot(focusRootId);
    for (const id of pageIds) pushRoot(id);

    // Visible total for the header. Hidden subtrees are subtracted in SQL for
    // non-owners; if that RPC is missing too, the raw count is close enough.
    let totalCommentCount = totalRowCount;
    const { data: visCount, error: visErr } = await db.rpc('get_visible_comment_count', {
      p_file_id: fileId,
      p_include_hidden: viewerIsFileOwner,
    });
    if (!visErr && visCount != null && Number.isFinite(Number(visCount))) {
      totalCommentCount = Number(visCount);
    }

    return {
      data: {
        data: roots.map(stripCommentBranchForApi),
        totalCount: totalRoots,
        totalCommentCount,
      },
      error: null,
    };
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

      // Parent must belong to this file and still be alive. The route also
      // checks this; keep it here so no other caller can forge a cross-file reply.
      if (input.parentId) {
        const { data: parent } = await db
          .from('comments')
          .select('id, file_id, is_deleted')
          .eq('id', input.parentId)
          .maybeSingle();
        if (!parent || parent.is_deleted || parent.file_id !== input.fileId) {
          return { data: null, error: 'Invalid parent comment' };
        }
      }

      const payload: Record<string, unknown> = {
        user_id: userId,
        file_id: input.fileId,
        content: hasText ? input.content!.trim() : '',
        parent_id: input.parentId || null,
      };
      // Only on top-level comments: a reply belongs to its thread, not to a
      // moment in the video, and marking replies would crowd the slider.
      if (!input.parentId && typeof input.timestampSeconds === 'number') {
        payload.timestamp_seconds = input.timestampSeconds;
      }
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
   * Resolves with how many comments the delete removed (the whole subtree),
   * so callers can keep displayed totals honest without a refetch.
   */
  async deleteComment(userId: string, commentId: string): Promise<CommentServiceResponse<{ deletedCount: number }>> {
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

      // Before deleting, grab every image attached to this comment + its reply
      // tree so we can purge them from storage afterwards. R2 keys are deleted
      // in-app; GitHub images go through GoUpload (the app holds no GitHub
      // token). Best-effort  a purge failure never blocks the delete.
      const r2KeysToDelete: string[] = [];
      const githubImagesToDelete: { path: string; repo: string }[] = [];
      try {
        const { data: imgRows } = await db.rpc('get_comment_tree_images', {
          p_comment_id: commentId,
        });
        if (Array.isArray(imgRows)) {
          for (const row of imgRows) {
            const r = row as {
              image_url?: string | null;
              storage_backend?: string | null;
              image_github_repo?: string | null;
            };
            if (typeof r.image_url !== 'string' || !r.image_url) continue;
            if (r.storage_backend === 'r2') {
              r2KeysToDelete.push(r.image_url);
            } else {
              const repo = typeof r.image_github_repo === 'string' ? r.image_github_repo.trim() : '';
              if (repo) githubImagesToDelete.push({ path: r.image_url, repo });
            }
          }
        }
      } catch (e) {
        console.warn('[comments] fetch tree images:', e);
      }

      // The whole subtree, walked level by level. Needed for an accurate
      // deleted count either way, and it doubles as the fallback delete set so
      // a missing RPC never strands live replies under a deleted parent
      // (those stayed in every count while nothing could display them).
      const subtree = new Set<string>([commentId]);
      let frontier: string[] = [commentId];
      for (let depth = 0; frontier.length > 0 && depth < MAX_THREAD_DEPTH && subtree.size < MAX_DESCENDANT_ROWS; depth++) {
        const { data: childRows, error: childErr } = await db
          .from('comments')
          .select('id')
          .in('parent_id', frontier)
          .eq('is_deleted', false)
          .limit(MAX_DESCENDANT_ROWS);
        if (childErr) break;
        frontier = ((childRows ?? []) as Array<{ id: string }>)
          .map((r) => r.id)
          .filter((id) => !subtree.has(id));
        for (const id of frontier) subtree.add(id);
      }
      const subtreeIds = [...subtree];

      // Soft-delete this comment and all nested replies recursively
      const { error } = await db.rpc('delete_comment_cascade', {
        p_comment_id: commentId,
      });

      if (error) {
        // Fallback when the RPC isn't deployed yet: soft-delete the collected
        // subtree in one statement instead of orphaning the replies.
        if (error.code === 'PGRST202') {
          const { error: fallbackError } = await db
            .from('comments')
            .update({ is_deleted: true, updated_at: new Date().toISOString() })
            .in('id', subtreeIds);
          if (fallbackError) {
            console.error('Error deleting comment:', fallbackError);
            return { data: null, error: 'Failed to delete comment' };
          }
        } else {
          console.error('Error deleting comment cascade:', error);
          return { data: null, error: 'Failed to delete comment' };
        }
      }

      // Fire-and-forget storage cleanup. We don't await it  the user already
      // got a success response and the soft-delete already hides the rows.
      if (r2KeysToDelete.length > 0) {
        const keys = r2KeysToDelete;
        void (async () => {
          const { r2DeleteObject } = await import('~/lib/r2.server');
          await Promise.all(
            keys.map((k) =>
              r2DeleteObject(k).catch((e) => {
                console.warn('[comments] r2 delete failed', k, e);
                return false;
              }),
            ),
          );
        })();
      }

      if (githubImagesToDelete.length > 0) {
        const images = githubImagesToDelete;
        void (async () => {
          const { deleteCommentImageFromStorage } = await import('~/lib/Services/commentImageStorage.server');
          await Promise.all(
            images.map((img) =>
              deleteCommentImageFromStorage(img.path, img.repo, 'github').catch((e) => {
                console.warn('[comments] github image delete failed', img.path, e);
                return false;
              }),
            ),
          );
          // Drop any leftover pre-post staging rows for these paths.
          try {
            await db!
              .from('comment_image_upload_repos')
              .delete()
              .in('storage_path', images.map((i) => i.path));
          } catch (e) {
            console.warn('[comments] staging cleanup failed', e);
          }
        })();
      }

      return { data: { deletedCount: subtreeIds.length }, error: null };
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

  /**
   * Pin / unpin a top-level comment. File owner only, one pinned per file.
   * Ownership + shape are re-checked inside the security-definer RPC, so this
   * can't pin a comment on someone else's file even if the id is guessed.
   */
  async setCommentPinned(userId: string, commentId: string, pinned: boolean): Promise<CommentServiceResponse<boolean>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data: existing } = await db
        .from('comments')
        .select('file_id, parent_id')
        .eq('id', commentId)
        .eq('is_deleted', false)
        .single();

      if (!existing) {
        return { data: null, error: 'Comment not found' };
      }
      if (existing.parent_id != null) {
        return { data: null, error: 'Only top-level comments can be pinned' };
      }

      const { data: ok, error } = await db.rpc('set_pinned_comment', {
        p_file_id: existing.file_id,
        p_comment_id: commentId,
        p_user_id: userId,
        p_pinned: pinned,
      });

      if (error) {
        console.error('Error pinning comment:', error);
        return { data: null, error: 'Failed to pin comment' };
      }
      if (ok !== true) {
        return { data: null, error: 'Only the file owner can pin comments' };
      }
      return { data: true, error: null };
    } catch (error) {
      console.error('Error in setCommentPinned:', error);
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

      // SQL counts the visible set in one round trip (hidden subtrees
      // subtracted for non-owners) — no row cap, so 100k comments count right.
      const { data: rpcCount, error: rpcErr } = await db.rpc('get_visible_comment_count', {
        p_file_id: fileId,
        p_include_hidden: viewerIsFileOwner,
      });
      if (!rpcErr && rpcCount != null && Number.isFinite(Number(rpcCount))) {
        return { data: Number(rpcCount), error: null };
      }
      if (rpcErr && !isMissingRpcError(rpcErr)) {
        console.warn('get_visible_comment_count:', rpcErr);
      }

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

