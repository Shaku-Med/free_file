import { isAuthenticated } from "~/lib/Security/Password";
import { commentService, type CreateCommentInput } from "~/lib/Services/CommentService";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    if (!fileId) {
      return toJson({ error: "fileId is required" }, 400);
    }

    if (limit < 1 || limit > 100) {
      return toJson({ error: "limit must be between 1 and 100" }, 400);
    }

    if (offset < 0) {
      return toJson({ error: "offset must be >= 0" }, 400);
    }

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

      if (!fileId || !content) {
        return toJson({ error: "fileId and content are required" }, 400);
      }

      const result = await commentService.createComment(user.id, {
        fileId,
        content,
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

      if (!commentId || !content) {
        return toJson({ error: "commentId and content are required" }, 400);
      }

      const result = await commentService.updateComment(user.id, commentId, content);

      if (result.error) {
        return toJson({ error: result.error }, 400);
      }

      return toJson({ data: result.data, success: true });
    }

    if (request.method === "DELETE") {
      const body = await request.json();
      const { commentId } = body;

      if (!commentId) {
        return toJson({ error: "commentId is required" }, 400);
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

