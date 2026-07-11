import bcrypt from 'bcrypt';
import { getAllKeys } from './unsharedkeyEncryption/Combined/Verification/TokenKeys';
import { DecryptCombine, EncryptCombine } from './unsharedkeyEncryption/Combined/Combined';
import { getCookie } from './Token';
import db from '../Database/supabase';

export const PasswordHash = async (password: string) => {
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        return hash;
    }
    catch (error) {
        console.error(error);
        return null;
    }
}

export const CreatePassword = async (password: string) => {
    try {
        const hash = await PasswordHash(password);
        if (!hash) return null;

        let keys = await getAllKeys(['password', 'authorization_key']);
        if (!keys) return null;

        let encryptedPassword = await EncryptCombine(hash, keys);
        if (!encryptedPassword) return null;

        return encryptedPassword;
    }
    catch (error) {
        console.error(error);
        return null;
    }
}


export const VerifyPassword = async (password: string, encryptedPassword: string) => {
    try {
        let keys = await getAllKeys(['password', 'authorization_key']);
        if (!keys) return null;

        let decryptedPassword = await DecryptCombine(encryptedPassword, keys);
        if (!decryptedPassword) return null;

        let isValid = await bcrypt.compare(password, decryptedPassword as string);
        return isValid;
    }
    catch (error) {
        console.error(error);
        return null;
    }
}


/** Columns callers may request from `users` via isAuthenticated. */
const ALLOWED_USER_COLUMNS = new Set([
    'id',
    'username',
    'email',
    'profile_pic',
    'verified',
    'dob',
    'history_paused',
    'is_memories',
    'theme',
    'c_usr',
    'show_nsfw',
]);

type ReturnUserSelect = string[] | undefined | null;

function whitelistUserSelect(cols: string[] | undefined | null): string[] {
    const requested = cols && cols.length > 0 ? cols : ['id'];
    const safe = requested.filter((c) => typeof c === 'string' && ALLOWED_USER_COLUMNS.has(c));
    return safe.length > 0 ? safe : ['id'];
}

export const isAuthenticated = async (request: Request, returnUser_Select?: ReturnUserSelect): Promise<any | boolean> => {
    try {
        if(!db) return null;
        let c_user = getCookie('c_user', request.headers);
        if(!c_user) return null;
        const keys = await getAllKeys(['token1', 'c_user'])
        if(!keys) return null;

        let decoded = await DecryptCombine(c_user, keys);
        if(!decoded || typeof decoded !== 'object' || !decoded.c_usr) return null;

        // Soft device bind: reject sessions minted for a different User-Agent.
        const { sessionUaMatches } = await import('./sessionFingerprint.server');
        if (!sessionUaMatches(decoded, request.headers)) return null;

        let shouldReturnUser = !!(returnUser_Select && returnUser_Select.length > 0);
        const cols = whitelistUserSelect(returnUser_Select);
        const { data: user, error } = await db
          .from('users')
          .select(cols.join(','))
          .eq('c_usr', decoded.c_usr).maybeSingle();
        if(error) return null;
        return shouldReturnUser ? user : true;
    }
    catch (error) {
        console.error(error);
        return null;
    }
}