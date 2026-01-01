import { VerifyToken } from './verifyToken.js';

export const VerifyVideoToken = async (token: string, req: any): Promise<any> => {
    try {
        const keys = ['video_token'];
        const verified = await VerifyToken({
            token: token,
            addedKeyNames: keys
        }, req);
        if (!verified) return null;
        return verified;
    } catch (error) {
        console.error('Error in VerifyVideoToken:', error);
        return null;
    }
};
