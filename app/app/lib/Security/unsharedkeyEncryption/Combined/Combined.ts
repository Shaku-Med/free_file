import jwt from 'jsonwebtoken';
import { encrypt, decrypt } from '../../Algorithm';

export const EncryptCombine = async (data: any, keys: any[], options?: object) => {
    try {
        let encryptedData = typeof data === 'object' ? JSON.stringify(data) : data;
        
        if (!keys || keys.length === 0) {
            return null;
        }
        
        for (let i = 0; i < keys.length - 1; i++) {
            if(typeof keys[i] === 'string') {
                encryptedData = await encrypt(encryptedData, keys[i]);
            }
            else {
                encryptedData = null
            }
        }

        if(!encryptedData) return null;
        const finalKey = keys[keys.length - 1];
        const jwtToken = jwt.sign({ data: encryptedData }, finalKey, options || {
            algorithm: 'HS512',
        });
        
        return jwtToken;
    } catch (error) {
        console.error("Encryption failed:", error);
        return null;
    }
};

export const DecryptCombine = async (data: any, keys: any[], options?: object) => {
    try {
        if(!data) return null;
        let encryptedData = typeof data === 'object' ? JSON.stringify(data) : data;
        
        if (!keys || keys.length === 0) {
            return null;
        }
        
        const finalKey = keys[keys.length - 1];
        // Pin the algorithm: every EncryptCombine call signs with HS512, so we
        // must only accept HS512. Without this, a token could declare a weaker
        // algorithm (or "none") and bypass signature verification.
        const verifyOptions: jwt.VerifyOptions = {
            ...(options || {}),
            algorithms: ['HS512'],
        };
        const decoded: any = jwt.verify(encryptedData, finalKey, verifyOptions);
        
        let decryptedData = decoded?.data;
        
        for (let i = keys.length - 2; i >= 0; i--) {
            if(typeof keys[i] === 'string') {
                decryptedData = await decrypt(decryptedData, keys[i]);
            }
            else {
                decryptedData = null
            }
        }

        if(!decryptedData) return null;
        
        try {
            return JSON.parse(decryptedData);
        } catch {
            return decryptedData;
        }
    } catch (e) {
        // An expired token is a NORMAL event (a returning user whose 30-day
        // session lapsed), not an error — logging a full stack trace for each
        // one floods the logs and buries real failures. Signal it with
        // `undefined` (callers treat that as "re-issue") and stay quiet.
        const isExpired =
            (e as { name?: string })?.name === 'TokenExpiredError' ||
            e?.toString()?.includes('expired');
        if (isExpired) return undefined;
        console.error("Decryption failed:", e);
        return null;
    }
};