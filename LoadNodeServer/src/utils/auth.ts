import express from 'express';
type Request = express.Request;
import db from './database.js';
import { getCookie } from './security.js';
import { getAllKeys } from './tokenKeys.js';
import { DecryptCombine } from './combined.js';

type ReturnUserSelect = string[] | undefined | null;

export const isAuthenticated = async (request: Request, returnUser_Select?: ReturnUserSelect): Promise<any | boolean | null> => {
    try {
        if (!db) return null;
        // const ck = getCookie('c_user', request.headers);
        const c_user = request.headers['c-user'] as string | null;
        if (!c_user) return null;
        const keys = await getAllKeys(['token1', 'c_user']);
        if (!keys) return null;

        const decoded = await DecryptCombine(c_user, keys);
        if (!decoded) return null;

        let shouldReturnUser = returnUser_Select && returnUser_Select!.length > 0;
        if (shouldReturnUser) {
            returnUser_Select = returnUser_Select as string[];
        } else {
            returnUser_Select = ['id'];
        }
        const returnUser_Select_String = returnUser_Select!.join(',');
        const { data: user, error } = await db
            .from('users')
            .select(returnUser_Select_String)
            .eq('c_usr', decoded.c_usr).maybeSingle();
        if (error) return null;
        
        // if(!ck){
        //     response?.setHeader(`c_user`, c_user);
        // }
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

interface FileData {
    is_adult: boolean;
    is_public: boolean;
    visibility?: string | null;
    owner_id: string;
    [key: string]: any;
}

// public and unlisted are both reachable without ownership; only private is not.
// Reading is_public alone treats unlisted as private. Falls back to the boolean
// for rows written before the visibility column existed.
const isOwnerOnly = (file: FileData): boolean => {
    const v = typeof file.visibility === 'string' ? file.visibility : null;
    if (v) return v === 'private';
    return file.is_public !== true;
};

interface UserData {
    id: string;
    dob: string;
    verified: boolean;
}

export const canAccessFile = async (
    request: Request,
    file: FileData,
): Promise<boolean> => {
    if (!file.is_adult && !isOwnerOnly(file)) {
        return true;
    }

    const user = await isAuthenticated(request, ['id', 'dob', 'verified']) as UserData | null | boolean;

    if (!user || typeof user === 'boolean') {
        return false;
    }

    if (file.is_adult) {
        if (!user.verified) {
            return false;
        }
        if (!isUserEighteenPlus(user.dob)) {
            return false;
        }
    }

    if (isOwnerOnly(file)) {
        if (!isFileOwner(user.id, file.owner_id)) {
            return false;
        }
    }

    return true;
};
