import { DecryptCombine } from './combined.js';
import { getClientIP } from './getIp.js';
import { getAllKeys, buildKeyNames } from './tokenKeys.js';

interface VerifyTokenProps {
    token: string;
    addedKeyNames?: readonly string[];
}

interface TokenHeaders {
    'sec-ch-ua-platform': string | null;
    'user-agent': string | null;
    'x-forwarded-for': string | null;
    [key: string]: unknown;
}

export const extractTokenHeaders = async (headers: any): Promise<TokenHeaders> => {
    const ip = await getClientIP(headers);
    return {
        'sec-ch-ua-platform': headers['sec-ch-ua-platform'] || null,
        'user-agent': (headers['user-agent']?.replace(/\s+/g, '') || null),
        'x-forwarded-for': ip || null
    };
};

export const VerifyToken = async (props: VerifyTokenProps, req: any): Promise<any> => {
    try {
        const ip = await getClientIP(req);
        if (!ip) return null;
        if (!props) return null;
        const { token, addedKeyNames } = props;

        const keyNames = buildKeyNames(['token1', 'token2', ...(addedKeyNames || [])]);
        const encryptionKeys = await getAllKeys(keyNames);
        
        if (!encryptionKeys) {
            return null;
        }

        const decryptedToken = await DecryptCombine(token, encryptionKeys);
        if (!decryptedToken || typeof decryptedToken !== 'object') return null;

        if (decryptedToken?.expiresAt && new Date(decryptedToken?.expiresAt) > new Date()) {
            const tokenHeaders = await extractTokenHeaders(req);
            if (tokenHeaders?.['user-agent'] !== decryptedToken?.['user-agent'] || 
                tokenHeaders?.['x-forwarded-for'] !== decryptedToken?.['x-forwarded-for'] || 
                tokenHeaders?.['sec-ch-ua-platform'] !== decryptedToken?.['sec-ch-ua-platform']) {
                return null;
            }
            return decryptedToken;
        }

        return null;
    } catch (error) {
        console.error('Error found in VerifyToken: -----> \n', error);
        return null;
    }
};
