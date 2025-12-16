import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return toJson({ liked: false }, 200);
    }

    if (!db) {
      return toJson({ liked: false }, 200);
    }

    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      return toJson({ error: "fileId is required" }, 400);
    }

    const { data } = await db
      .from('likes')
      .select('id')
      .eq('user_id', user.id)
      .eq('file_id', fileId)
      .maybeSingle();

    return toJson({ liked: !!data }, 200);
  } catch (error) {
    console.error('Error checking like:', error);
    return toJson({ liked: false }, 200);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (!db) {
      return toJson({ error: "Database not initialized" }, 500);
    }

    const body = await request.json();
    const { fileId } = body;

    if (!fileId || typeof fileId !== 'string') {
      return toJson({ error: "Invalid fileId" }, 400);
    }

    if (request.method === "POST") {
      const { data: existingLike, error: checkError } = await db
        .from('likes')
        .select('id')
        .eq('user_id', user.id)
        .eq('file_id', fileId)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking existing like:', checkError);
        return toJson({ error: "Database error" }, 500);
      }

      if (existingLike) {
        return toJson({ error: "Already liked" }, 400);
      }

      const { data: existingDislike } = await db
        .from('dislike')
        .select('id')
        .eq('user_id', user.id)
        .eq('file_id', fileId)
        .maybeSingle();

      if (existingDislike) {
        await db
          .from('dislike')
          .delete()
          .eq('user_id', user.id)
          .eq('file_id', fileId);

        const { data: file } = await db
          .from('files')
          .select('down_count')
          .eq('id', fileId)
          .single();

        if (file) {
          const newDownCount = Math.max(0, Number(file.down_count || 0) - 1);
          await db
            .from('files')
            .update({ down_count: newDownCount })
            .eq('id', fileId);
        }
      }

      const { error: likeError } = await db
        .from('likes')
        .insert([{
          user_id: user.id,
          file_id: fileId
        }]);

      if (likeError) {
        console.error('Error inserting like:', likeError);
        return toJson({ error: "Failed to like" }, 500);
      }

      const { data: file } = await db
        .from('files')
        .select('up_count, down_count')
        .eq('id', fileId)
        .single();

      if (file) {
        const newUpCount = Number(file.up_count || 0) + 1;
        const { data: updatedFile } = await db
          .from('files')
          .update({ up_count: newUpCount })
          .eq('id', fileId)
          .select('up_count, down_count')
          .single();

        return toJson({ 
          success: true, 
          liked: true,
          upCount: Number(updatedFile?.up_count || 0),
          downCount: Number(updatedFile?.down_count || 0)
        });
      }

      return toJson({ success: true, liked: true });
    }

    if (request.method === "DELETE") {
      const { error: deleteError } = await db
        .from('likes')
        .delete()
        .eq('user_id', user.id)
        .eq('file_id', fileId);

      if (deleteError) {
        console.error('Error deleting like:', deleteError);
        return toJson({ error: "Failed to unlike" }, 500);
      }

      const { data: file } = await db
        .from('files')
        .select('up_count, down_count')
        .eq('id', fileId)
        .single();

      if (file) {
        const newUpCount = Math.max(0, Number(file.up_count || 0) - 1);
        const { data: updatedFile } = await db
          .from('files')
          .update({ up_count: newUpCount })
          .eq('id', fileId)
          .select('up_count, down_count')
          .single();

        return toJson({ 
          success: true, 
          liked: false,
          upCount: Number(updatedFile?.up_count || 0),
          downCount: Number(updatedFile?.down_count || 0)
        });
      }

      return toJson({ success: true, liked: false });
    }

    return toJson({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error('Error processing like:', error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
