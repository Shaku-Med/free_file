import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { commentService, type CreateCommentInput } from "~/lib/Services/CommentService";
import { createNotification } from "~/lib/Services/NotificationService";
import { sendPushForNotification } from "~/lib/Services/PushService";
import { validatePagination, isValidFileId, sanitizeCommentContent, validateInteger } from "~/lib/Security/inputValidation";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const focusCommentIdRaw = url.searchParams.get('focusCommentId');

    if (!fileId || !isValidFileId(fileId)) {
      return toJson({ error: "Invalid fileId" }, 400);
    }

    const limit = validateInteger(limitParam, 1, 100) || 50;
    const offset = validateInteger(offsetParam, 0, 10000) || 0;
    const focusCommentId =
      focusCommentIdRaw && isValidFileId(focusCommentIdRaw) ? focusCommentIdRaw : null;

    const user = await isAuthenticated(request, ['id']).catch(() => null);
    const currentUserId = user?.id ?? null;

    const result = await commentService.getCommentsTreeByFileId(
      fileId,
      limit,
      offset,
      currentUserId,
      focusCommentId
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
    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (request.method === "POST") {
      const body = await request.json();
      const { fileId, content, parentId, gif, image }: CreateCommentInput & {
        fileId: string;
        content?: string;
        parentId?: string;
        gif?: { id: string; url: string; previewUrl?: string };
        image?: { url: string; type: string };
      } = body;

      // Validate inputs
      if (!fileId || !isValidFileId(fileId)) {
        return toJson({ error: "Invalid fileId" }, 400);
      }

      // Check if comments are enabled and within limit
      if (db) {
        try {
          const { data: fileRow } = await db.from('files').select('comments_enabled, comment_limit').eq('id', fileId).maybeSingle();
          if (fileRow && fileRow.comments_enabled === false) {
            return toJson({ error: "Comments are disabled for this file" }, 403);
          }
          // Enforce comment limit if set
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

      const result = await commentService.createComment(user.id, {
        fileId,
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
            sendPushForNotification(parentRow.user_id, 'comment_reply', user.id, fileId, comment.id).catch((e) => console.error("[Push] comment_reply failed:", e));
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
            sendPushForNotification(fileRow.owner_id, 'file_comment', user.id, fileId, comment.id).catch((e) => console.error("[Push] file_comment failed:", e));
          }
        }
        // Notify mentioned users (only if they exist and are not the commenter)
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
                sendPushForNotification(row.id, 'comment_mention', user.id, fileId, comment.id).catch((e) => console.error("[Push] comment_mention failed:", e));
              }
            }
          }
        }
      }

      return toJson({ data: comment, success: true });
    }

    if (request.method === "PATCH") {
      const body = await request.json();
      const { commentId, content } = body;

      if (!commentId || !isValidFileId(commentId)) {
        return toJson({ error: "Invalid commentId" }, 400);
      }

      if (!content || typeof content !== 'string') {
        return toJson({ error: "content is required" }, 400);
      }

      // Sanitize comment content
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
      const body = await request.json();
      const { commentId } = body;

      if (!commentId || !isValidFileId(commentId)) {
        return toJson({ error: "Invalid commentId" }, 400);
      }

      const result = await commentService.deleteComment(user.id, commentId);

      if (result.error) {
        return toJson({ error: result.error }, 400);
      }

      return toJson({ success: true });
    }

    // HIDE/UNHIDE  file owner only
    if (request.method === "PUT") {
      const body = await request.json();
      const { commentId, hidden } = body;

      if (!commentId || !isValidFileId(commentId)) {
        return toJson({ error: "Invalid commentId" }, 400);
      }

      if (typeof hidden !== 'boolean') {
        return toJson({ error: "hidden must be a boolean" }, 400);
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

