import { EnvValidator } from './env.js';

interface ServerTokenKey {
    readonly name: string;
    readonly key: (string | null)[];
    readonly algorithm: string;
}

interface ServerTokenKeyConfig {
    readonly name: string;
    readonly envKey: string;
    readonly algorithm: string;
}

const SERVER_TOKEN_KEY_CONFIGS: readonly ServerTokenKeyConfig[] = [
    {
        name: "server_to_server_key",
        envKey: "SERVER_TO_SERVER_KEY",
        algorithm: "HS512"
    },
    {
        name: "server_to_server_key_1",
        envKey: "SERVER_TO_SERVER_KEY_1",
        algorithm: "HS512"
    },
    {
        name: "server_to_server_key_2",
        envKey: "SERVER_TO_SERVER_KEY_2",
        algorithm: "HS512"
    }
] as const;

const createServerTokenKeys = (): ServerTokenKey[] => {
    return SERVER_TOKEN_KEY_CONFIGS
        .map(config => ({
            name: config.name,
            key: [EnvValidator(config.envKey)],
            algorithm: config.algorithm
        }))
        .filter(key => key.key.every(k => k !== null && k !== undefined));
};

const serverTokenKeysCache = new Map<string, ServerTokenKey[]>();

export const getServerTokenKeys = (): ServerTokenKey[] => {
    const cacheKey = "all";
    
    if (serverTokenKeysCache.has(cacheKey)) {
        return serverTokenKeysCache.get(cacheKey)!;
    }
    
    try {
        const keys = createServerTokenKeys();
        serverTokenKeysCache.set(cacheKey, keys);
        return keys;
    } catch (error) {
        console.error("ServerTokenKeys initialization failed:", error);
        return [];
    }
};

export const getServerTokenKey = (name: string): (string | null)[] | null => {
    if (!name || typeof name !== "string") {
        return null;
    }
    
    try {
        const keys = getServerTokenKeys();
        const key = keys.find(k => k.name === name);
        return key?.key || null;
    } catch (error) {
        console.error("GetServerTokenKey failed:", error);
        return null;
    }
};

export const getAllServerKeys = async (names: string[]): Promise<(string | null)[] | null> => {
    if (!Array.isArray(names) || names.length === 0) {
        return null;
    }
    
    try {
        const keyPromises = names.map(name => Promise.resolve(getServerTokenKey(name)));
        const allKeys = await Promise.all(keyPromises);
        
        const hasNullKeys = allKeys.some(key => key === null || key === undefined);
        if (hasNullKeys) {
            return null;
        }
        
        return allKeys.flat();
    } catch (error) {
        console.error("GetAllServerKeys failed:", error);
        return null;
    }
};
