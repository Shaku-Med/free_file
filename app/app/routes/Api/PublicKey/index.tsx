import { getCookie } from "~/lib/Security/Token";
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
import { ServerEncryption } from "~/lib/Security/Server/Encryption";
import SetToken from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken";

const usedAuthTokens: Map<string, number> = new Map()
const TEN_MIN_MS = 10 * 60 * 1000
const MAX_CACHE_SIZE = 200000

const sweepExpired = () => {
    const now = Date.now()
    for (const [k, exp] of usedAuthTokens) if (exp <= now) usedAuthTokens.delete(k)
    if (usedAuthTokens.size > MAX_CACHE_SIZE) {
        const entries = Array.from(usedAuthTokens.entries()).sort((a, b) => a[1] - b[1])
        const toDelete = entries.slice(0, Math.floor(entries.length / 2))
        for (const [k] of toDelete) usedAuthTokens.delete(k)
    }
}

let sweepTimer: NodeJS.Timeout | null = null
if (!sweepTimer) sweepTimer = setInterval(sweepExpired, TEN_MIN_MS)

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
        sweepExpired()
        if (usedAuthTokens.has(authorization)) return new Response(null, { status: 401 })
        let keys = ['file_token']
        let decoded = await VerifyToken({ token: authorization, addedKeyNames: keys }, request.headers)
        if(!decoded) return new Response(null, { status: 401 })
        usedAuthTokens.set(authorization, Date.now() + TEN_MIN_MS);
    
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