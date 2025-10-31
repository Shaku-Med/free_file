export const EnvValidator = (env: string) => {
    try {
        console.log(import.meta.env[env])
        if(!process.env[env]) return null;
        return process.env[env] || null;
    }
    catch (error) {
        console.log(`Error Found in EnvValidator.tsx: --- `, error)
        return null;
    }
}