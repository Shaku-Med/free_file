import { isAuthenticated } from "~/lib/Security/Password";
import { commentService, type CreateCommentInput } from "~/lib/Services/CommentService";
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

    // Validate fileId
    if (!fileId || !isValidFileId(fileId)) {
      return toJson({ error: "Invalid fileId" }, 400);
    }

    // Validate pagination
    const limit = validateInteger(limitParam, 1, 100) || 50;
    const offset = validateInteger(offsetParam, 0, 10000) || 0;

    const result = await commentService.getCommentsByFileId(fileId, limit, offset);

    if (result.error) {
      return toJson({ error: result.error }, 500);
    }

    return toJson({ data: result.data, success: true });
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
      const { fileId, content, parentId }: CreateCommentInput & { fileId: string; content: string; parentId?: string } = body;

      // Validate inputs
      if (!fileId || !isValidFileId(fileId)) {
        return toJson({ error: "Invalid fileId" }, 400);
      }

      if (!content || typeof content !== 'string') {
        return toJson({ error: "content is required" }, 400);
      }

      // Sanitize comment content
      const sanitizedContent = sanitizeCommentContent(content);
      if (!sanitizedContent || sanitizedContent.length < 1) {
        return toJson({ error: "Comment content is too short or invalid" }, 400);
      }

      // Validate parentId if provided
      if (parentId && !isValidFileId(parentId)) {
        return toJson({ error: "Invalid parentId" }, 400);
      }

      const result = await commentService.createComment(user.id, {
        fileId,
        content: sanitizedContent,
        parentId: parentId || null
      });

      if (result.error) {
        return toJson({ error: result.error }, 400);
      }

      return toJson({ data: result.data, success: true });
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

