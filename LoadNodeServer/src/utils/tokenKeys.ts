import { EnvValidator } from './env.js';

interface TokenKey {
    readonly name: string;
    readonly key: (string | null)[];
    readonly algorithm: string;
    readonly expiresIn: string;
}

interface TokenKeyConfig {
    readonly name: string;
    readonly envKey: string;
    readonly algorithm: string;
    readonly expiresIn: string;
}

const TOKEN_KEY_CONFIGS: readonly TokenKeyConfig[] = [
    {
        name: "authorization_key",
        envKey: "AUTHORIZATION_KEY",
        algorithm: "HS512",
        expiresIn: "2m"
    },
    {
        name: "token1",
        envKey: "TOKEN1",
        algorithm: "HS512",
        expiresIn: "2m"
    },
    {
        name: "token2",
        envKey: "TOKEN2",
        algorithm: "HS512",
        expiresIn: "2m"
    },
    {
        name: "file_token",
        envKey: "FILE_TOKEN",
        algorithm: "HS512",
        expiresIn: "10m"
    },
    {
        name: "temp_token",
        envKey: "TEMP_TOKEN",
        algorithm: "HS512",
        expiresIn: "10s"
    },
    {
        name: "session_id",
        envKey: "SESSION_ID",
        algorithm: "HS512",
        expiresIn: "10s"
    },
    {
        name: "video_token",
        envKey: "VIDEO_TOKEN",
        algorithm: "HS512",
        expiresIn: "1d"
    },
    {
        name: "password",
        envKey: "PASSWORDS",
        algorithm: "HS512",
        expiresIn: "1d"
    },
    {
        name: "c_user",
        envKey: "C_USER",
        algorithm: "HS512",
        expiresIn: "1d"
    },
    {
        name: "server_auth",
        envKey: "SERVER_AUTH",
        algorithm: "HS512",
        expiresIn: "1m"
    }
] as const;

const createTokenKeys = (): TokenKey[] => {
    return TOKEN_KEY_CONFIGS
        .map(config => ({
            name: config.name,
            key: [EnvValidator(config.envKey)],
            algorithm: config.algorithm,
            expiresIn: config.expiresIn
        }))
        .filter(key => key.key.every(k => k !== null && k !== undefined));
};

const tokenKeysCache = new Map<string, TokenKey[]>();

export const getTokenKeys = (): TokenKey[] => {
    const cacheKey = "all";
    
    if (tokenKeysCache.has(cacheKey)) {
        return tokenKeysCache.get(cacheKey)!;
    }
    
    try {
        const keys = createTokenKeys();
        tokenKeysCache.set(cacheKey, keys);
        return keys;
    } catch (error) {
        console.error("TokenKeys initialization failed:", error);
        return [];
    }
};

export const getTokenKey = (name: string): (string | null)[] | null => {
    if (!name || typeof name !== "string") {
        return null;
    }
    
    try {
        const keys = getTokenKeys();
        const key = keys.find(k => k.name === name);
        return key?.key || null;
    } catch (error) {
        console.error("GetTokenKey failed:", error);
        return null;
    }
};

export const getAllKeys = async (names: string[]): Promise<(string | null)[] | null> => {
    if (!Array.isArray(names) || names.length === 0) {
        return null;
    }
    
    try {
        const keyPromises = names.map(name => Promise.resolve(getTokenKey(name)));
        const allKeys = await Promise.all(keyPromises);
        
        const hasNullKeys = allKeys.some(key => key === null || key === undefined);
        if (hasNullKeys) {
            return null;
        }
        
        return allKeys.flat();
    } catch (error) {
        console.error("GetAllKeys failed:", error);
        return null;
    }
};

export const buildKeyNames = (additionalKeyNames?: readonly string[]): string[] => {
    const DEFAULT_KEY_NAMES = ['authorization_key'] as const;
    if (!Array.isArray(additionalKeyNames) || additionalKeyNames.length === 0) {
        return [...DEFAULT_KEY_NAMES];
    }
    
    return [...DEFAULT_KEY_NAMES, ...additionalKeyNames];
};
