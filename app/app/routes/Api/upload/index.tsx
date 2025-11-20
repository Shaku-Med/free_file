import { VerifyToken } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken';
import { FileService } from '../../../lib/Services/FileService';
import { config } from '../../../lib/config';
import { getCookie } from '~/lib/Security/Token';
import * as crypto from 'crypto'

const fileService = new FileService(
  config.github.token,
  config.github.owner
);


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
    const name = formData.get('name') as string;
    const isAdultParam = formData.get('is_adult') as string | null;
    const isAdult = isAdultParam === 'true' ? true : (isAdultParam === 'false' ? false : undefined);
    
    if (!file || !uniqueID || !name) {
      return new Response(`Invalid request`, { status: 400 });
    }

    await fileService.initialize();
    
    const result = await fileService.uploadFile({
      file,
      uniqueID,
      filename: name,
      isAdult
    });

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      // githubPath: result.githubPath,
      // supabaseId: result.supabaseId
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