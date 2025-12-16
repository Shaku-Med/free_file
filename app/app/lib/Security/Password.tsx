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


type ReturnUserSelect = string[] | undefined | null;
export const isAuthenticated = async (request: Request, returnUser_Select?: ReturnUserSelect): Promise<any | boolean> => {
    try {
        if(!db) return null;
        let c_user = getCookie('c_user', request.headers);
        if(!c_user) return null;
        const keys = await getAllKeys(['token1', 'c_user'])
        if(!keys) return null;

        let decoded = await DecryptCombine(c_user, keys);
        if(!decoded) return null;

        let shouldReturnUser = returnUser_Select && returnUser_Select!.length > 0;
        if(shouldReturnUser) {
            returnUser_Select = returnUser_Select as string[];
        }
        else {
            returnUser_Select = ['id'];
        }
        let returnUser_Select_String = returnUser_Select!.join(',');
        const { data: user, error } = await db
          .from('users')
          .select(returnUser_Select_String)
          .eq('c_usr', decoded.c_usr).maybeSingle();
        if(error) return null;
        return shouldReturnUser ? user : true;
    }
    catch (error) {
        console.error(error);
        return null;
    }
}