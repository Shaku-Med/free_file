import express from 'express';
type Request = express.Request;
import db from './database.js';
import { getAllKeys } from './tokenKeys.js';
import { DecryptCombine } from './combined.js';

type ReturnUserSelect = string[] | undefined | null;

const SESSION_KEY_NAMES = ['token1', 'c_user'] as const;
const LOAD_KEY_NAMES = ['video_token', 'token1'] as const;

function bearerFromAuthorization(request: Request): string | null {
    const raw = request.headers['authorization'];
    if (typeof raw !== 'string') return null;
    const m = raw.match(/^Bearer\s+(.+)$/i);
    return m?.[1]?.trim() || null;
}

async function userFromLoadToken(
    token: string,
    returnUser_Select: string[],
): Promise<any | null> {
    const keys = await getAllKeys([...LOAD_KEY_NAMES]);
    if (!keys) return null;
    const decoded = await DecryptCombine(token, keys);
    if (!decoded || typeof decoded !== 'object') return null;
    if (decoded.typ !== 'load') return null;
    if (typeof decoded.c_usr !== 'string' || !decoded.c_usr) return null;

    const returnUser_Select_String = returnUser_Select.join(',');
    const { data: user, error } = await db
        .from('users')
        .select(returnUser_Select_String)
        .eq('c_usr', decoded.c_usr)
        .maybeSingle();
    if (error || !user) return null;
    // Optional uid bind — reject if the mint uid doesn't match the row.
    if (typeof decoded.uid === 'string' && decoded.uid && (user as any).id && decoded.uid !== (user as any).id) {
        return null;
    }
    return user;
}

async function userFromSessionToken(
    token: string,
    returnUser_Select: string[],
): Promise<any | null> {
    const keys = await getAllKeys([...SESSION_KEY_NAMES]);
    if (!keys) return null;
    const decoded = await DecryptCombine(token, keys);
    if (!decoded?.c_usr) return null;

    const returnUser_Select_String = returnUser_Select.join(',');
    const { data: user, error } = await db
        .from('users')
        .select(returnUser_Select_String)
        .eq('c_usr', decoded.c_usr)
        .maybeSingle();
    if (error) return null;
    return user;
}

/**
 * Auth for LoadNode media.
 * Accepts, in order:
 *   1. Authorization: Bearer <load token>  (minted by /api/load/auth)
 *   2. c-user header (session JWT) — for clients that can set headers
 * Cookie alone is intentionally NOT enough for adult/private (see canAccessFile).
 */
export const isAuthenticated = async (
    request: Request,
    returnUser_Select?: ReturnUserSelect,
): Promise<any | boolean | null> => {
    try {
        if (!db) return null;

        let shouldReturnUser = !!(returnUser_Select && returnUser_Select.length > 0);
        const select = shouldReturnUser
            ? (returnUser_Select as string[])
            : ['id'];

        const bearer = bearerFromAuthorization(request);
        if (bearer) {
            let user = await userFromLoadToken(bearer, select);
            if (!user) user = await userFromSessionToken(bearer, select);
            if (!user) return null;
            return shouldReturnUser ? user : true;
        }

        // Header only — do not fall back to cookie here for identity used by
        // adult/private gates (cookie fallback would re-enable standalone tabs).
        const c_user = (request.headers['c-user'] as string | null | undefined) || null;
        if (!c_user) return null;

        const user = await userFromSessionToken(c_user, select);
        if (!user) return null;
        return shouldReturnUser ? user : true;
    } catch (error) {
        console.error(error);
        return null;
    }
};

export const isUserEighteenPlus = (dob: string): boolean => {
    const birthDate = new Date(dob);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        return age - 1 >= 18;
    }

    return age >= 18;
};

export const isFileOwner = (userId: string, ownerId: string): boolean => {
    return userId === ownerId;
};

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 't', '1', 'yes', 'y'].includes(normalized)) return true;
        if (['false', 'f', '0', 'no', 'n'].includes(normalized)) return false;
        return fallback;
    }
    return fallback;
};

interface FileData {
    is_adult: boolean;
    is_public: boolean;
    visibility?: string | null;
    owner_id: string;
    upload_status?: string | null;
    [key: string]: any;
}

const isOwnerOnly = (file: FileData): boolean => {
    const v = typeof file.visibility === 'string' ? file.visibility : null;
    if (v) return v === 'private';
    return file.is_public !== true;
};

interface UserData {
    id: string;
    dob: string;
    verified: boolean;
    show_nsfw?: boolean | null;
}

/**
 * Mirrors the app's `canAccessMediaLoad` gate:
 * - Public/unlisted non-adult: open (CDN).
 * - Adult/private: REQUIRE `Authorization: Bearer <load token>` from
 *   /api/load/auth. Cookie / bare URL / address-bar → denied.
 */
export const canAccessFile = async (
    request: Request,
    file: FileData,
): Promise<boolean> => {
    const uploadStatus = typeof file.upload_status === 'string'
        ? file.upload_status.trim().toLowerCase()
        : null;
    const isCompleted = uploadStatus === 'completed' || uploadStatus === 'complete';
    const adult = normalizeBoolean(file.is_adult);
    const privateOnly = isOwnerOnly(file);

    // Public/unlisted non-adult: standalone CDN ok (once upload finished).
    if (!adult && !privateOnly) {
        if (uploadStatus && !isCompleted) {
            const bearer = bearerFromAuthorization(request);
            if (!bearer) return false;
            const user = await isAuthenticated(request, [
                'id',
                'dob',
                'verified',
                'show_nsfw',
            ]) as UserData | null | boolean;
            const authed = user && typeof user !== 'boolean' ? user : null;
            return !!authed && isFileOwner(authed.id, file.owner_id);
        }
        return true;
    }

    // Adult or private: Bearer only. No cookie, no c-user-only, no standalone.
    const bearer = bearerFromAuthorization(request);
    if (!bearer) return false;

    const user = await isAuthenticated(request, [
        'id',
        'dob',
        'verified',
        'show_nsfw',
    ]) as UserData | null | boolean;

    const authed = user && typeof user !== 'boolean' ? user : null;
    if (!authed) return false;

    const isOwner = isFileOwner(authed.id, file.owner_id);

    if (uploadStatus && !isCompleted) {
        return isOwner;
    }

    if (privateOnly) {
        return isOwner;
    }

    // adult
    if (!normalizeBoolean(authed.show_nsfw)) return false;
    if (!authed.verified) return false;
    if (!isUserEighteenPlus(authed.dob)) return false;
    return true;
};
