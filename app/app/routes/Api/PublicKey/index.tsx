import { getCookie } from "~/lib/Security/Token";
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import { ServerEncryption } from "~/lib/Security/Server/Encryption";
import SetToken from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken";
import { claimOnce, digest } from "~/lib/kv.server";

const TEN_MIN_MS = 10 * 60 * 1000

let VerifyB4Fetching = async (request: Request) => {
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
        console.error('Error in VerifyB4Fetching:', error)
        return null
    }
}


const generateTempToken = async (request: Request) => {
    try {
        let keys = ['temp_token']
        let token = await SetToken(request.headers, {
            expiresIn: '10s',
            algorithm: 'HS512'
        }, keys)
        if(!token) return null
        return token.data
    }
    catch (error) {
        console.error('Error in generateTempToken:', error)
        return null
    }
}

export const loader = async ({ request }: { request: Request }) => {
    try {
        let verified = await VerifyB4Fetching(request)
        if(!verified) return new Response(null, { status: 401 });
        let authorization = request.headers.get('Authorization')
        if(!authorization) return new Response(null, { status: 401 });
        authorization = authorization.split(' ')[1]
        if (!authorization || authorization.length > 4096) return new Response(null, { status: 401 })
        let keys = ['file_token']
        let decoded = await VerifyToken({ token: authorization, addedKeyNames: keys }, request.headers)
        if(!decoded) return new Response(null, { status: 401 })
        // Each file token works once, across every app instance.
        if (!(await claimOnce(`pk:${digest(authorization)}`, TEN_MIN_MS))) return new Response(null, { status: 401 })
    
        let publicKey = new ServerEncryption().getPublicKey()
        let tempToken = await generateTempToken(request)
        if(!tempToken) return new Response(null, { status: 500 });

        return new Response(JSON.stringify({ publicKey, session: tempToken }), { status: 200 })
    }
    catch (error) {
        console.error('Error in loader:', error)
        return new Response(null, { status: 500 })
    }
}