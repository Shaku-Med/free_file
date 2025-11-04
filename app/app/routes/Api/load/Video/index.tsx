import { getCookie } from "~/lib/Security/Token";
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import { VerifyVideoToken } from "~/routes/Dynamic/components/Functions";

export const VKF = async (request: Request) => {
    try {
        let keys = ['token1', 'token2']
        let token = getCookie('token', request.headers)
        if(!token) return null

        let decoded = await VerifyToken({
            token: token,
            addedKeyNames: keys || []
        }, request.headers)
        if(!decoded) return null
        return true
    }
    catch (error) {
        console.error('Error in VKF:', error)
        return null
    }
}

export const GetVideoToken = async (request: Request) => {
    try {
        let token = getCookie('videoToken', request.headers)
        if(!token) return null
        const verified = await VerifyVideoToken(token, request.headers)
        if(!verified ||!request.url.includes(`/${verified?.id}/`)) return null
        return true
    }
    catch (error) {
        console.error('Error in GetVideoToken:', error)
        return null
    }
}

export const loader = async ({ request }: { request: Request }) => {
    try {
        let verified = await VKF(request)
        if(!verified) return new Response(null, { status: 401 });

        let token = await GetVideoToken(request)
        if(!token) return new Response(null, { status: 401 });
        
        const splitUrl = request.url.split('/api/load/video/')[1];
        const videoUrl = `https://github.com/${process.env.GITHUB_OWNER}/Memories/raw/main/${splitUrl}`;
        const response = await fetch(videoUrl);
    
        if (!response.ok) throw new Error('Fetch failed');
    
        const ext = splitUrl.split('.').pop();
        const isText = ext === 'm3u8';
        const body = isText ? await response.text() : new Uint8Array(await response.arrayBuffer());
        const contentType =
            ext === 'm3u8'
            ? 'application/vnd.apple.mpegurl'
            : ext === 'ts'
            ? 'video/mp2t'
            : 'application/octet-stream';
    
        const origin = new URL(request.url).origin;
        return new Response(body, {
            status: 200,
            headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Credentials': 'true',
            'Vary': 'Origin',
            'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (error) {
        console.error('Error loading video:', error);
        return new Response(null, { status: 500 });
    }
};
  