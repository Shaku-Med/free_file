import { DecryptCombine } from './combined.js';
import { getAllServerKeys } from './serverTokenKeys.js';
import { EncryptCombine } from './combined.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface EnvData {
    [key: string]: string;
}

interface ServerEnvResponse {
    data?: string;
    error?: string;
}

const setEnvInMemory = async (envData: EnvData): Promise<void> => {
    for (const [key, value] of Object.entries(envData)) {
        process.env[key] = value;
    }
};

const generateAuthToken = async (): Promise<string | null> => {
    try {
        const serverKeys = await getAllServerKeys(['server_to_server_key']);
        if (!serverKeys || serverKeys.length === 0) {
            return null;
        }

        const authData = {
            type: 'server_auth',
            timestamp: new Date().toISOString()
        };

        const token = await EncryptCombine(authData, serverKeys, {
            algorithm: 'HS512'
        });

        return token;
    } catch (error) {
        console.error('Error generating auth token:', error);
        return null;
    }
};

const fetchEnvData = async (mainAppUrl: string, retries: number = 3): Promise<EnvData | null> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const authToken = await generateAuthToken();
            if (!authToken) {
                console.error(`Attempt ${attempt}: Failed to generate auth token. Check if SERVER_TO_SERVER_KEY is set in environment.`);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                return null;
            }

            const url = `${mainAppUrl}/api/server-env`;
            console.log(`Attempt ${attempt}: Fetching from ${url}`);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    console.error(`Attempt ${attempt}: Authentication failed`);
                } else if (response.status === 404) {
                    console.error(`Attempt ${attempt}: Server returned 404. Is the main app running at ${mainAppUrl}? Is the /api/server-env route registered?`);
                } else {
                    console.error(`Attempt ${attempt}: Server returned ${response.status}`);
                }
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                return null;
            }

            const result = await response.json() as ServerEnvResponse;
            if (!result || typeof result !== 'object' || !result.data || typeof result.data !== 'string') {
                console.error(`Attempt ${attempt}: No data in response`);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                return null;
            }

            const encryptedData: string = result.data;
            const serverKeys = await getAllServerKeys(['server_to_server_key_1', 'server_to_server_key_2']);
            if (!serverKeys || serverKeys.length === 0) {
                console.error(`Attempt ${attempt}: Server keys not available`);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                return null;
            }

            const decryptedData = await DecryptCombine(encryptedData, serverKeys);
            if (!decryptedData || typeof decryptedData !== 'object') {
                console.error(`Attempt ${attempt}: Decryption failed`);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                return null;
            }

            return decryptedData as EnvData;
        } catch (error) {
            console.error(`Attempt ${attempt}: Error fetching env data:`, error);
            if (error instanceof Error) {
                if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
                    console.error(`Attempt ${attempt}: Cannot connect to ${mainAppUrl}. Is the main app server running?`);
                }
            }
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
        }
    }
    return null;
};

export const initializeEnv = async (mainAppUrl: string): Promise<boolean> => {
    try {
        const envData = await fetchEnvData(mainAppUrl);
        if (!envData) {
            console.error('Failed to fetch environment data after retries');
            return false;
        }

        setEnvInMemory(envData);
        console.log('Environment variables loaded successfully');
        return true;
    } catch (error) {
        console.error('Error initializing environment:', error);
        return false;
    }
};

export const refreshEnv = async (mainAppUrl: string): Promise<boolean> => {
    return await initializeEnv(mainAppUrl);
};
