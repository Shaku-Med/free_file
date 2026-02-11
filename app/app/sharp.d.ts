declare module 'sharp' {
    interface SharpInstance {
        png(): SharpInstance;
        toBuffer(): Promise<Buffer>;
    }
    function sharp(input?: unknown): SharpInstance;
    export default sharp;
}
