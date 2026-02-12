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

    if (!fileId || !isValidFileId(fileId)) {
      return toJson({ error: "Invalid fileId" }, 400);
    }

    const limit = validateInteger(limitParam, 1, 100) || 50;
    const offset = validateInteger(offsetParam, 0, 10000) || 0;

    const user = await isAuthenticated(request, ['id']).catch(() => null);
    const currentUserId = user?.id ?? null;

    const result = await commentService.getCommentsTreeByFileId(fileId, limit, offset, currentUserId);

    if (result.error) {
      return toJson({ error: result.error }, 500);
    }

    if (!result.data) {
      return toJson({ data: [], totalCount: 0, success: true });
    }

    return toJson({
      data: result.data.data,
      totalCount: result.data.totalCount,
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
      const { fileId, content, parentId, gif }: CreateCommentInput & { fileId: string; content?: string; parentId?: string; gif?: { id: string; url: string; previewUrl?: string } } = body;

      // Validate inputs
      if (!fileId || !isValidFileId(fileId)) {
        return toJson({ error: "Invalid fileId" }, 400);
      }

      const hasText = typeof content === 'string' && content.trim().length > 0;
      const hasGif = gif && typeof gif.id === 'string' && typeof gif.url === 'string';
      if (!hasText && !hasGif) {
        return toJson({ error: "Comment must have text or a GIF" }, 400);
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
              commentId: parentId,
            });
            sendPushForNotification(parentRow.user_id, 'comment_reply', user.id, fileId).catch(() => {});
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
            sendPushForNotification(fileRow.owner_id, 'file_comment', user.id, fileId).catch(() => {});
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
                sendPushForNotification(row.id, 'comment_mention', user.id, fileId).catch(() => {});
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

    return toJson({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error('Error in comments action:', error);
    return toJson({ error: "Internal server error" }, 500);
  }
};

