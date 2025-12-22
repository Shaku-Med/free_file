export const EnvValidator = (env: string) => {
    try {
        // Only use process.env (server-side only)
        // Never expose environment variables to client-side code
        if (typeof process !== 'undefined' && process.env && process.env[env]) {
            return process.env[env];
        }
        return null;
    }
    catch (error) {
        console.log(`Error Found in EnvValidator.tsx: --- `, error)
        return null;
    }
}