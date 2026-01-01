export const EnvValidator = (env: string): string | null => {
    try {
        if (!process.env[env]) return null;
        return process.env[env] || null;
    } catch (error) {
        console.log(`Error Found in EnvValidator: --- `, error);
        return null;
    }
};
