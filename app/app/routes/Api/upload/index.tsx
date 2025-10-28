import { FileService } from '../../../lib/Services/FileService';
import { config } from '../../../lib/config';

const fileService = new FileService(
  config.github.token,
  config.github.owner
);

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const uniqueID = formData.get('uniqueID') as string;
    const name = formData.get('name') as string;
    
    if (!file || !uniqueID || !name) {
      return new Response(`Invalid request`, { status: 400 });
    }

    await fileService.initialize();
    
    const result = await fileService.uploadFile({
      file,
      uniqueID,
      filename: name
    });

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      githubPath: result.githubPath,
      supabaseId: result.supabaseId
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ error: 'Upload failed' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}