import { getAllServerKeys } from '~/lib/Security/unsharedkeyEncryption/ServerToServer/ServerTokenKeys';
import { EnvValidator } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/EnvValidator';

const REQUIRED_ENV_KEYS = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'GITHUB_OWNER',
    'AUTHORIZATION_KEY',
    'TOKEN1',
    'TOKEN2',
    'C_USER',
    'VIDEO_TOKEN',
    'FILE_TOKEN',
    'TEMP_TOKEN',
    'SESSION_ID',
    'PASSWORDS',
    'SERVER_AUTH',
    // R2 creds for LoadNodeServer: without these, getR2Client() returns null
    // and every R2-backed image / profile pic silently falls back to GitHub.
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'R2_ENDPOINT',
    'R2_REGION',
    'R2_PRESIGN_TTL_SECONDS',
];

const getEnvData = (): Record<string, string> => {
    const envData: Record<string, string> = {};
    for (const key of REQUIRED_ENV_KEYS) {
        const value = EnvValidator(key);
        if (value) {
            envData[key] = value;
        }
    }
    return envData;
};

export const loader = async ({ request }: { request: Request }) => {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const authToken = authHeader.substring(7);
        const authServerKeys = await getAllServerKeys(['server_to_server_key']);
        
        if (!authServerKeys || authServerKeys.length === 0) {
            return new Response(JSON.stringify({ error: 'Server configuration error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { DecryptCombine } = await import('~/lib/Security/unsharedkeyEncryption/Combined/Combined');
        const decryptedAuth = await DecryptCombine(authToken, authServerKeys);
        
        if (!decryptedAuth || typeof decryptedAuth !== 'object') {
            return new Response(JSON.stringify({ error: 'Invalid authorization token' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (decryptedAuth.type !== 'server_auth' || !decryptedAuth.timestamp) {
            return new Response(JSON.stringify({ error: 'Invalid token format' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const ts = new Date(decryptedAuth.timestamp).getTime();
        if (!Number.isFinite(ts)) {
            return new Response(JSON.stringify({ error: 'Invalid token format' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        const tokenAge = Date.now() - ts;
        // Reject expired tokens AND future-dated ones (negative age): without
        // the lower bound, a token minted with a far-future timestamp would
        // pass the replay window forever. Allow a small clock-skew tolerance.
        const SKEW_MS = 5000;
        if (tokenAge > 60000 || tokenAge < -SKEW_MS) {
            return new Response(JSON.stringify({ error: 'Token expired' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const envData = getEnvData();
        const envServerKeys = await getAllServerKeys(['server_to_server_key_1', 'server_to_server_key_2']);
        
        if (!envServerKeys || envServerKeys.length === 0) {
            return new Response(JSON.stringify({ error: 'Server configuration error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { EncryptCombine } = await import('~/lib/Security/unsharedkeyEncryption/Combined/Combined');
        const encryptedEnv = await EncryptCombine(envData, envServerKeys, {
            algorithm: 'HS512'
        });

        if (!encryptedEnv) {
            return new Response(JSON.stringify({ error: 'Encryption failed' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ data: encryptedEnv }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store, no-cache, must-revalidate'
            }
        });
    } catch (error) {
        console.error('Error in server-env endpoint:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
