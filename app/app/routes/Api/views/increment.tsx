import { data } from 'react-router';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { isValidFileId, isValidUUID } from '~/lib/Security/inputValidation';

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * POST /api/views/increment
 * Increment view count for a file
 */
export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') {
      return toJson({ error: 'Method not allowed' }, 405);
    }

    if (!db) {
      return toJson({ error: 'Database not initialized' }, 500);
    }

    const body = await request.json();
    const { fileId, uniqueId } = body;

    // Validate inputs
    if (!fileId && !uniqueId) {
      return toJson({ error: 'fileId or uniqueId is required' }, 400);
    }

    if (fileId && !isValidUUID(fileId)) {
      return toJson({ error: 'Invalid fileId format' }, 400);
    }

    if (uniqueId && !isValidFileId(uniqueId)) {
      return toJson({ error: 'Invalid uniqueId format' }, 400);
    }

    // Get file by ID or unique_id
    let fileQuery = db.from('files').select('id, views, view_count');
    
    if (fileId) {
      fileQuery = fileQuery.eq('id', fileId);
    } else {
      fileQuery = fileQuery.eq('unique_id', uniqueId);
    }

    const { data: file, error: fileError } = await fileQuery.single();

    if (fileError || !file) {
      return toJson({ error: 'File not found' }, 404);
    }

    // Increment both views and view_count
    const currentViews = Number(file.views || 0);
    const currentViewCount = Number(file.view_count || 0);
    
    const { data: updatedFile, error: updateError } = await db
      .from('files')
      .update({
        views: currentViews + 1,
        view_count: currentViewCount + 1,
      })
      .eq('id', file.id)
      .select('views, view_count')
      .single();

    if (updateError) {
      console.error('Error incrementing views:', updateError);
      return toJson({ error: 'Failed to increment views' }, 500);
    }

    return toJson({
      success: true,
      views: Number(updatedFile?.views || 0),
      view_count: Number(updatedFile?.view_count || 0),
    }, 200);
  } catch (error) {
    console.error('Error in views increment action:', error);
    return toJson({ error: 'Internal server error' }, 500);
  }
};
