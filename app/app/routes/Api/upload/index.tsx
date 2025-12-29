import { VerifyToken } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken';
import { uploadQueue } from './processFunctions/queue';
import { getCookie } from '~/lib/Security/Token';
import { initializeWorker } from './processFunctions/worker';
import { isAuthenticated } from '~/lib/Security/Password';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto'

if (typeof process !== 'undefined') {
  try {
    initializeWorker();
  } catch (error) {
    console.warn('Upload worker will be initialized when Redis is available.');
  }
}


const VerifyB4Uploading = async (headers: Headers) => {
  try {
    let keys = ['session_id']

    let token = getCookie('sessionId', headers)
    if(!token) return null
    let decoded = await VerifyToken({
      token: token,
      addedKeyNames: keys || []
    }, headers)
    if(!decoded) return null
    let sessionIdHex = typeof decoded.sessionID === 'string' ? decoded.sessionID : ''
    let providedHex = headers.get('x-session-id') || ''
    const isHex = (s: string) => /^[0-9a-f]+$/i.test(s)
    if(!isHex(sessionIdHex)) return null
    if(providedHex){
      if(!isHex(providedHex)) return null
      const a = Buffer.from(sessionIdHex.toLowerCase(), 'hex')
      const b = Buffer.from(providedHex.toLowerCase(), 'hex')
      if(a.length !== b.length) return null
      if(!crypto.timingSafeEqual(a, b)) return null
    }
    return true
  }
  catch {
    return null
  }
}


const serverToServerUpload = async (request: Request): Promise<boolean> => {
  try {
    let authorization = request.headers.get('server-to-server-token')
    if(!authorization) return false
    authorization = authorization.split(' ')[1]
    if(process.env.VIDEO_TOKEN !== authorization) return false
    return true 
  }
  catch {
    return false
  }
}

export const action = async ({ request }: { request: Request }) => {
  try {

    let serverToServer = await serverToServerUpload(request)
    if(!serverToServer) {
      let keys = ['token1', 'token2']
      let token = getCookie('token', request.headers)
      if(!token) return new Response(JSON.stringify({ 
          error: 'Something went wrong! Please try again later.' 
      }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
      });

      let decoded = await VerifyToken({
          token: token,
          addedKeyNames: keys || []
      }, request.headers)
      if(!decoded) return new Response(JSON.stringify({ 
          error: `Your request is not authorized!` 
      }), { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
      });

      let verified = await VerifyB4Uploading(request.headers)
      if(!verified) return new Response(JSON.stringify({ 
          error: `Your file upload request was denied!`
      }), { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
      });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const uniqueID = formData.get('uniqueID') as string;
    const title = formData.get('title') as string | null;
    const description = formData.get('description') as string | null;
    
    if (!file || !uniqueID || !title) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: 'File size exceeds maximum limit of 500MB' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(uniqueID)) {
      return new Response(JSON.stringify({ error: 'Invalid uniqueID format' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (title.length > 200) {
      return new Response(JSON.stringify({ error: 'Title must be 200 characters or less' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (description && description.length > 5000) {
      return new Response(JSON.stringify({ error: 'Description must be 5000 characters or less' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      return new Response(JSON.stringify({ error: 'Unsupported file type. Only images and videos are allowed.' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const fileName = file.name.toLowerCase();
    const validImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const validVideoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m3u8'];
    
    const fileExtension = fileName.substring(fileName.lastIndexOf('.'));
    const isValidExtension = isImage 
      ? validImageExtensions.includes(fileExtension)
      : validVideoExtensions.includes(fileExtension);

    if (!isValidExtension) {
      return new Response(JSON.stringify({ error: 'File extension does not match file type' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tempDir = join(process.cwd(), 'upload', 'temp');
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    const user = await isAuthenticated(request, ['id']);
    
    if (!serverToServer && (!user || typeof user === 'boolean' || !user.id)) {
      return new Response(JSON.stringify({ error: 'Authentication required to upload files' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const ownerId = serverToServer 
      ? (process.env.DEFAULT_ID || '')
      : (user && typeof user !== 'boolean' && user.id ? user.id : process.env.DEFAULT_ID);

    if (!ownerId) {
      return new Response(JSON.stringify({ error: 'Invalid owner ID' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const filePath = join(tempDir, `upload_${uniqueID}_${randomUUID()}`);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, fileBuffer);

    const jobId = await uploadQueue.addJob({
      file: {
        filePath: filePath,
        originalName: file.name,
        mimeType: file.type,
        size: file.size
      },
      uniqueID,
      title,
      description: description || undefined,
      ownerId
    });

    if (!jobId) {
      await unlink(filePath).catch(() => {});
      return new Response(JSON.stringify({ error: 'Failed to queue upload' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      jobId
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