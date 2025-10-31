import { ServerEncryption } from "~/lib/Security/Server/Encryption"
import { getCookie } from "~/lib/Security/Token"
import SetToken from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken"
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken"

let encryption = new ServerEncryption()

let VerifyB4Handshaking = async (request: Request) => {
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
        console.error('Error in VerifyB4Handshaking:', error)
        return null
    }
}

const verifyAuthorization = async (request: Request) => {
    try {
        let authorization = request.headers.get('Authorization')
        if(!authorization) return null
        authorization = authorization.split(' ')[1]
        let keys = ['temp_token']
        let decoded = await VerifyToken({
            token: authorization,
            addedKeyNames: keys || []
        }, request.headers)
        if(!decoded) return null
        return true
    }
    catch (error) {
        console.error('Error in verifyAuthorization:', error)
        return null
    }
}

const generateSessionId = async (clientPublicKey: string, request: Request) => {
    try {
        let sharedSecrete = encryption.deriveSharedSecret(clientPublicKey)
        if(!sharedSecrete) return null
        let sessionID = sharedSecrete.toString('hex')
        let keys = ['session_id']

        let token = await SetToken(request.headers, {
            expiresIn: '30d',
            algorithm: 'HS512'
        }, keys, { sessionID })
        if(!token) return null
        return token.data
    }
    catch (error) {
        console.error('Error in generateSessionId:', error)
        return null
    }
}

export const action = async ({ request }: { request: Request }) => {
    try {
        let verified = await VerifyB4Handshaking(request)
        if(!verified) return new Response(null, { status: 401 });
        let authorization = await verifyAuthorization(request)
        if(!authorization) return new Response(null, { status: 401 });
        
        let body = await request.json()
        if(!body.clientPublicKey) return new Response(null, { status: 400 });

        let sessionId = await generateSessionId(body.clientPublicKey, request)
        if(!sessionId) return new Response(null, { status: 500 });

        return new Response(JSON.stringify({ success: true }), { 
            status: 200,
            headers: {
                'Set-Cookie': `sessionId=${sessionId}; Path=/; HttpOnly; Max-Age=2592000; ${process.env.NODE_ENV === 'production' ? 'Secure' : ''}; SameSite=Strict`
            }
        })
    }
    catch (error) {
        console.error('Error in action:', error)
        return new Response(null, { status: 500 })
    }
}