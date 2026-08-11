import { isAuthenticated } from "~/lib/Security/Password";
import { canAct } from "~/lib/Security/accountStatus.server";
import { checkCommentPostRateLimit } from "~/routes/Api/fun/personalizationRateLimit";
import db from "~/lib/Database/supabase";
import { commentService, type CreateCommentInput } from "~/lib/Services/CommentService";
import { createNotification } from "~/lib/Services/NotificationService";
import { enqueuePush } from "~/lib/Services/PushQueue.server";
import { isValidFileId, sanitizeCommentContent, validateInteger } from "~/lib/Security/inputValidation";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";
import { isSameOrigin } from "~/lib/Security/sameOrigin.server";
import { getCookie } from "~/lib/Security/Token";
import {
  validateRequestSignature,
  readBodyForSigning,
} from "~/lib/Security/requestSignature.server";
import {
  denyIfFileUnreadable,
  denyIfParentUnusable,
  loadCommentForAccess,
  isAllowedCommentGifUrl,
} from "~/routes/Api/fun/commentAccess.server";
import { checkCommentGetRateLimit } from "~/routes/Api/fun/personalizationRateLimit";

/** Guests only see the first page. Matches the UI page size. */
const GUEST_PAGE_LIMIT = 50;
/** Signed in users can ask for up to this many roots/replies per call. */
const AUTH_PAGE_LIMIT = 100;

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });

/** Browser shaped fetch only. Also run here so a layout skip can't open the door. */
function denyIfNotAppFetch(request: Request, opts?: { sameOrigin?: boolean }): Response | null {
  const blocked = assertSafeRequest(request, { apiFetchOnly: true });
  if (blocked) return blocked;
  // Mutations always need Origin/Referer. Reads are already locked down by
  // Sec-Fetch, so we don't fail a privacy browser that strips Referer on GET.
  if (opts?.sameOrigin && !isSameOrigin(request)) {
    return toJson({ error: "Forbidden" }, 403);
  }
  return null;
}

/**
 * Cookie HMAC check used by watch issue and friends. Only callers that already
 * proved they have a session need this. Guests never get a signing key.
 */
function denyIfBadSignature(
  request: Request,
  cookieValue: string,
  bodyBytes: Uint8Array | null,
): Response | null {
  const sig = validateRequestSignature(request, {
    cookieValue,
    bodyBytes,
  });
  if (sig.valid) return null;
  console.warn("[comments] signature rejected:", sig.reason);
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  });
  if (
    sig.reason === "stale_ts" ||
    sig.reason === "hmac_mismatch" ||
    sig.reason === "missing_sig_headers"
  ) {
    headers.set("X-Sig-Stale", "1");
  }
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 401,
    headers,
  });
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const gate = denyIfNotAppFetch(request);
    if (gate) return gate;

    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const focusCommentIdRaw = url.searchParams.get('focusCommentId');

    if (!fileId || !isValidFileId(fileId)) {
      return toJson({ error: "Invalid fileId" }, 400);
    }

    const offset = validateInteger(offsetParam, 0, 10000) || 0;
    const parentIdRaw = url.searchParams.get('parentId');

    const user = await isAuthenticated(request, ['id']).catch(() => null);
    const currentUserId = user?.id ?? null;

    // Deep-link focus can pull a whole chain past the first page. Guests don't
    // get that lever — only signed in viewers with a valid HMAC do.
    const focusCommentId =
      currentUserId && focusCommentIdRaw && isValidFileId(focusCommentIdRaw)
        ? focusCommentIdRaw
        : null;

    // Guests get the first page of root comments and nothing else: no
    // pagination, no reply threads. Both are refused before the file lookup so
    // neither lever can be used to probe file ids.
    if (!currentUserId && (offset > 0 || parentIdRaw)) {
      return toJson({ error: "sign_in_required" }, 401);
    }

    // Any signed in read needs the browser HMAC. A stolen cookie alone is
    // not enough to scrape threads, even for page one.
    if (currentUserId) {
      const cookieValue = getCookie("c_user", request.headers);
      if (!cookieValue) return toJson({ error: "Unauthorized" }, 401);
      const badSig = denyIfBadSignature(request, cookieValue, null);
      if (badSig) return badSig;
    }

    if (!checkCommentGetRateLimit(request, currentUserId).allowed) {
      return toJson({ error: "Too many requests" }, 429);
    }

    const denied = await denyIfFileUnreadable(request, fileId);
    if (denied) return denied;

    const pageLimit = currentUserId
      ? validateInteger(limitParam, 1, AUTH_PAGE_LIMIT) || 50
      : Math.min(validateInteger(limitParam, 1, GUEST_PAGE_LIMIT) || GUEST_PAGE_LIMIT, GUEST_PAGE_LIMIT);

    if (parentIdRaw) {
      if (!isValidFileId(parentIdRaw)) return toJson({ error: "Invalid parentId" }, 400);
      // Guests were turned away above, so this branch is always authenticated.
      const replyLimit = validateInteger(limitParam, 1, 50) || 20;
      const replies = await commentService.getRepliesByCommentId(
        fileId,
        parentIdRaw,
        replyLimit,
        offset,
        currentUserId
      );
      if (replies.error) return toJson({ error: replies.error }, 500);
      return toJson({
        data: replies.data?.data ?? [],
        totalCount: replies.data?.totalCount ?? 0,
        success: true,
      });
    }

    const result = await commentService.getCommentsTreeByFileId(
      fileId,
      pageLimit,
      offset,
      currentUserId,
      focusCommentId,
      // Focusing a comment has to deliver the thread it lives in, otherwise the
      // deep link lands on a collapsed parent.
      Boolean(focusCommentId)
    );

    if (result.error) {
      return toJson({ error: result.error }, 500);
    }

    if (!result.data) {
      return toJson({ data: [], totalCount: 0, success: true });
    }

    return toJson({
      data: result.data.data,
      totalCount: result.data.totalCount,
      totalCommentCount: result.data.totalCommentCount,
      success: true,
    });
  } catch (error) {
    console.error('Error in comments loader:', error);
    return toJson({ error: "Internal server error" }, 500);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const gate = denyIfNotAppFetch(request, { sameOrigin: true });
    if (gate) return gate;

    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    const cookieValue = getCookie("c_user", request.headers);
    if (!cookieValue) return toJson({ error: "Unauthorized" }, 401);

    const bodyReader = await readBodyForSigning(request);
    const badSig = denyIfBadSignature(request, cookieValue, bodyReader.bytes);
    if (badSig) return badSig;

    // Restricted/terminated accounts can still READ comments (the loader is
    // untouched) but cannot post, edit or delete.
    if (!(await canAct(user.id))) {
      return toJson({ error: "account_restricted" }, 403);
    }

    if (request.method === "POST") {
      if (!checkCommentPostRateLimit(request, user.id).allowed) {
        return toJson({ error: "Too many requests" }, 429);
      }
      const body = bodyReader.json() as CreateCommentInput & {
        fileId: string;
        content?: string;
        parentId?: string;
        gif?: { id: string; url: string; previewUrl?: string };
        image?: { url: string; type: string };
        timestampSeconds?: unknown;
      };
      const { fileId, content, parentId, gif, image, timestampSeconds } = body;

      if (!fileId || !isValidFileId(fileId)) {
        return toJson({ error: "Invalid fileId" }, 400);
      }

      // Same visibility gate as the loader: no posting on private / gated files.
      const unreadable = await denyIfFileUnreadable(request, fileId);
      if (unreadable) return unreadable;

      if (db) {
        try {
          const { data: fileRow } = await db.from('files').select('comments_enabled, comment_limit').eq('id', fileId).maybeSingle();
          if (fileRow && fileRow.comments_enabled === false) {
            return toJson({ error: "Comments are disabled for this file" }, 403);
          }
          if (fileRow && typeof fileRow.comment_limit === 'number' && fileRow.comment_limit >= 0) {
            if (fileRow.comment_limit === 0) {
              return toJson({ error: "Comments are disabled for this file" }, 403);
            }
            const { count } = await db
              .from('comments')
              .select('*', { count: 'exact', head: true })
              .eq('file_id', fileId)
              .eq('is_deleted', false);
            if (typeof count === 'number' && count >= fileRow.comment_limit) {
              return toJson({ error: `Comment limit reached (${fileRow.comment_limit})` }, 403);
            }
          }
        } catch {
          // columns may not exist yet  allow comments by default
        }
      }

      const hasText = typeof content === 'string' && content.trim().length > 0;
      const hasGif = gif && typeof gif.id === 'string' && typeof gif.url === 'string';
      const hasImage = image && typeof image.url === 'string';
      if (!hasText && !hasGif && !hasImage) {
        return toJson({ error: "Comment must have text, a GIF, or an image" }, 400);
      }
      if (hasGif && !isAllowedCommentGifUrl(String(gif!.url))) {
        return toJson({ error: "Invalid GIF reference" }, 400);
      }
      if (
        hasGif &&
        gif!.previewUrl &&
        typeof gif!.previewUrl === "string" &&
        !isAllowedCommentGifUrl(gif!.previewUrl)
      ) {
        return toJson({ error: "Invalid GIF reference" }, 400);
      }

      // image.url is client-supplied. The comment-image upload flow only ever
      // produces one of two storage-key shapes (see GoUpload commentimg handler;
      // date folders are DD_MM_YYYY per arrangeDateForThumbnail):
      //   comment-images/<uid>/<imageId>.<ext>
      //   <dd_mm_yyyy>/<uniqueId>/comments/<imageId>.<ext>
      // Reject anything else so an attacker can't store an absolute URL,
      // a javascript: payload, a traversal path, or someone else's private
      // storage key that /api/load/image would then proxy.
      if (hasImage) {
        const u = image!.url.trim();
        const COMMENT_IMAGE_KEY =
          /^(comment-images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+|\d{2}_\d{2}_\d{4}\/[A-Za-z0-9_-]+\/comments\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+)$/;
        if (
          u.length > 300 ||
          u.includes('..') ||
          u.includes('\\') ||
          !COMMENT_IMAGE_KEY.test(u)
        ) {
          return toJson({ error: "Invalid image reference" }, 400);
        }
      }

      const sanitizedContent = hasText ? sanitizeCommentContent(content!) : '';
      if (hasText && (!sanitizedContent || sanitizedContent.length < 1)) {
        return toJson({ error: "Comment content is too short or invalid" }, 400);
      }
      if (hasText && sanitizedContent.length > 2000) {
        return toJson({ error: "Comment content exceeds maximum length" }, 400);
      }

      if (parentId && !isValidFileId(parentId)) {
        return toJson({ error: "Invalid parentId" }, 400);
      }
      if (parentId) {
        const badParent = await denyIfParentUnusable(fileId, parentId, user.id);
        if (badParent) return badParent;
      }

      // Client-supplied, so clamped to the file's real duration below rather
      // than trusted. Absent is normal: a comment from the feed has no playhead.
      let commentAt: number | null = null;
      const rawAt = Number(timestampSeconds);
      if (!parentId && Number.isFinite(rawAt) && rawAt >= 0) {
        const { data: durRow } = await db
          .from('files')
          .select('duration')
          .eq('id', fileId)
          .maybeSingle();
        const dur = Number((durRow as { duration?: unknown } | null)?.duration);
        if (Number.isFinite(dur) && dur > 0) {
          commentAt = Math.min(Math.round(rawAt), Math.floor(dur));
        }
      }

      const result = await commentService.createComment(user.id, {
        fileId,
        timestampSeconds: commentAt,
        content: sanitizedContent,
        parentId: parentId || null,
        gif: hasGif ? { id: gif!.id, url: gif!.url, previewUrl: gif!.previewUrl || gif!.url } : null,
        image: hasImage ? { url: image!.url, type: image!.type || 'image/jpeg' } : null,
      });

      if (result.error) {
        return toJson({ error: result.error }, 400);
      }

      const comment = result.data!;
      if (db) {
        if (parentId) {
          const { data: parentRow } = await db.from('comments').select('user_id').eq('id', parentId).maybeSingle();
          if (parentRow?.user_id) {
            await createNotification({
              userId: parentRow.user_id,
              type: 'comment_reply',
              actorId: user.id,
              fileId,
              commentId: comment.id,
            });
            void enqueuePush(parentRow.user_id, 'comment_reply', user.id, fileId, null);
          }
        } else {
          const { data: fileRow } = await db.from('files').select('owner_id').eq('id', fileId).maybeSingle();
          if (fileRow?.owner_id) {
            await createNotification({
              userId: fileRow.owner_id,
              type: 'file_comment',
              actorId: user.id,
              fileId,
              commentId: comment.id,
            });
            void enqueuePush(fileRow.owner_id, 'file_comment', user.id, fileId, null);
          }
        }
        if (hasText && sanitizedContent) {
          const mentionRegex = /@([\w.-]+)/g;
          const usernames = new Set<string>();
          let m: RegExpExecArray | null;
          while ((m = mentionRegex.exec(sanitizedContent)) !== null) usernames.add(m[1]);
          if (usernames.size > 0) {
            const { data: mentionedUsers } = await db
              .from('users')
              .select('id')
              .in('username', [...usernames]);
            for (const row of mentionedUsers ?? []) {
              if (row.id !== user.id) {
                await createNotification({
                  userId: row.id,
                  type: 'comment_mention',
                  actorId: user.id,
                  fileId,
                  commentId: comment.id,
                });
                void enqueuePush(row.id, 'comment_mention', user.id, fileId, null);
              }
            }
          }
        }
      }

      return toJson({ data: comment, success: true });
    }

    if (request.method === "PATCH") {
      const body = bodyReader.json() as { commentId?: string; content?: string };
      const { commentId, content } = body;

      if (!commentId || !isValidFileId(commentId)) {
        return toJson({ error: "Invalid commentId" }, 400);
      }

      const existing = await loadCommentForAccess(commentId);
      if (!existing) return toJson({ error: "Not found" }, 404);
      const unreadable = await denyIfFileUnreadable(request, existing.file_id);
      if (unreadable) return unreadable;

      if (!content || typeof content !== 'string') {
        return toJson({ error: "content is required" }, 400);
      }

      const sanitizedContent = sanitizeCommentContent(content);
      if (!sanitizedContent || sanitizedContent.length < 1) {
        return toJson({ error: "Comment content is too short or invalid" }, 400);
      }

      const result = await commentService.updateComment(user.id, commentId, sanitizedContent);

      if (result.error) {
        return toJson({ error: result.error }, 400);
      }

      return toJson({ data: result.data, success: true });
    }

    if (request.method === "DELETE") {
      const body = bodyReader.json() as { commentId?: string };
      const { commentId } = body;

      if (!commentId || !isValidFileId(commentId)) {
        return toJson({ error: "Invalid commentId" }, 400);
      }

      const existing = await loadCommentForAccess(commentId);
      if (!existing) return toJson({ error: "Not found" }, 404);
      const unreadable = await denyIfFileUnreadable(request, existing.file_id);
      if (unreadable) return unreadable;

      const result = await commentService.deleteComment(user.id, commentId);

      if (result.error) {
        return toJson({ error: result.error }, 400);
      }

      return toJson({ success: true, deletedCount: result.data?.deletedCount ?? 1 });
    }

    if (request.method === "PUT") {
      const body = bodyReader.json() as {
        commentId?: string;
        hidden?: boolean;
        pinned?: boolean;
      };
      const { commentId, hidden, pinned } = body;

      if (!commentId || !isValidFileId(commentId)) {
        return toJson({ error: "Invalid commentId" }, 400);
      }

      const existing = await loadCommentForAccess(commentId);
      if (!existing) return toJson({ error: "Not found" }, 404);
      const unreadable = await denyIfFileUnreadable(request, existing.file_id);
      if (unreadable) return unreadable;

      if (typeof pinned === 'boolean') {
        const result = await commentService.setCommentPinned(user.id, commentId, pinned);
        if (result.error) {
          return toJson(
            { error: result.error },
            result.error === 'Only the file owner can pin comments' ? 403 : 400,
          );
        }
        return toJson({ success: true, pinned });
      }

      if (typeof hidden !== 'boolean') {
        return toJson({ error: "hidden or pinned must be a boolean" }, 400);
      }

      const result = await commentService.hideComment(user.id, commentId, hidden);

      if (result.error) {
        return toJson({ error: result.error }, result.error === 'Only the file owner can hide comments' ? 403 : 400);
      }

      return toJson({ success: true });
    }

    return toJson({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error('Error in comments action:', error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
