import { EnvValidator } from "./EnvValidator";
import { getClientIP } from "./GetIp";

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

interface TokenHeaders {
    readonly 'sec-ch-ua-platform': string | null;
    readonly 'user-agent': string | null;
    readonly 'x-forwarded-for': string | null;
    readonly [key: string]: unknown;
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

export const clearTokenKeysCache = (): void => {
    tokenKeysCache.clear();
};


const DEFAULT_KEY_NAMES = ['authorization_key'] as const;



export const extractTokenHeaders = async (headers: Headers): Promise<TokenHeaders> => {
    let ip = await getClientIP(headers)
    return {
        'sec-ch-ua-platform': headers.get('sec-ch-ua-platform'),
        'user-agent': headers.get('user-agent')?.replace(/\s+/g, '') || null,
        'x-forwarded-for': ip as string || null
    };
};

export const validateHeaders = (headers: TokenHeaders): boolean => {
    return Object.values(headers).some(value => value !== null && value !== undefined);
};

export const mergeTokenData = (
    baseData: TokenHeaders, 
    additionalData?: Record<string, unknown>
): Record<string, unknown> => {
    if (!additionalData || typeof additionalData !== 'object') {
        return baseData;
    }
    
    return { ...baseData, ...additionalData };
};

export const buildKeyNames = (additionalKeyNames?: readonly string[]): string[] => {
    if (!Array.isArray(additionalKeyNames) || additionalKeyNames.length === 0) {
        return [...DEFAULT_KEY_NAMES];
    }
    
    return [...DEFAULT_KEY_NAMES, ...additionalKeyNames];
};

export const getTokenHeaders = async (headers: Headers): Promise<TokenHeaders | null> => {
    try {
        const tokenHeaders = await extractTokenHeaders(headers);
        
        if (!validateHeaders(tokenHeaders)) {
            return null;
        }
        
        return tokenHeaders;
    } catch (error) {
        console.error("GetTokenHeaders failed:", error);
        return null;
    }
};