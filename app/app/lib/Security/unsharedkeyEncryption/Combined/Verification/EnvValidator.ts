export const EnvValidator = (env: string) => {
    try {
        // NEVER log env values here  this runs for secret keys (TOKEN1/2, etc.)
        // and would leak them to stdout/log aggregators.
        if(!process.env[env]) return null;
        return process.env[env] || null;
    }
    catch (error) {
        console.log(`Error Found in EnvValidator.tsx: --- `, error)
        return null;
    }
}