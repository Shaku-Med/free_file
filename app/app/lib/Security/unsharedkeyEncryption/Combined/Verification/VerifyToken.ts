import { DecryptCombine } from "../Combined";
import { getClientIP } from "./GetIp";
import { getAllKeys } from "./TokenKeys";
import { buildKeyNames, extractTokenHeaders } from "./TokenKeys";

interface VerifyTokenProps {
    token: string
    addedKeyNames?: readonly string[];
}

export const VerifyToken = async (props: VerifyTokenProps, headers: Headers) => {
    try {
        let h = headers
        let ip = await getClientIP(h)
        if(!ip) return null;
        if(!props) return null;
        let { token, addedKeyNames } = props

        const keyNames = buildKeyNames(['token1', 'token2', ...addedKeyNames || []]);
        const encryptionKeys = await getAllKeys(keyNames);
        
        if (!encryptionKeys) {
            return null;
        }

        const decryptedToken = await DecryptCombine(token, encryptionKeys);
        if(!decryptedToken || typeof decryptedToken !== 'object') return null;

        if(decryptedToken?.expiresAt && new Date(decryptedToken?.expiresAt) > new Date()) {
            const tokenHeaders = await extractTokenHeaders(h);
            if(tokenHeaders?.['user-agent'] !== decryptedToken?.['user-agent'] || tokenHeaders?.['x-forwarded-for'] !== decryptedToken?.['x-forwarded-for'] || tokenHeaders?.['sec-ch-ua-platform'] !== decryptedToken?.['sec-ch-ua-platform']) return null;
            return decryptedToken;
        };

        return null;
    }
    catch (error) {
        console.error('Error found in VerifyToken: -----> \n', error)
        return null
    }
}