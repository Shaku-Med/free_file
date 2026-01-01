import { createClient } from '@supabase/supabase-js';
import { EnvValidator } from './env.js';

let db: any = null;
let isInitialized = false;

const createChainableFallback = () => {
    const errorResponse = { data: null, error: new Error('Supabase client not initialized') };
    const errorPromise = Promise.resolve(errorResponse);
    
    const createChainable = (): any => {
        const chainable: any = {
            select: () => createChainable(),
            insert: () => createChainable(),
            update: () => createChainable(),
            delete: () => createChainable(),
            upsert: () => createChainable(),
            eq: () => createChainable(),
            neq: () => createChainable(),
            in: () => createChainable(),
            not: () => createChainable(),
            like: () => createChainable(),
            ilike: () => createChainable(),
            or: () => createChainable(),
            order: () => createChainable(),
            limit: () => createChainable(),
            range: () => createChainable(),
            is: () => createChainable(),
            gte: () => createChainable(),
            lte: () => createChainable(),
            single: () => errorPromise,
            maybeSingle: () => errorPromise,
        };
        
        chainable.then = errorPromise.then.bind(errorPromise);
        chainable.catch = errorPromise.catch.bind(errorPromise);
        chainable.finally = errorPromise.finally?.bind(errorPromise);
        
        return chainable;
    };
    
    return createChainable();
};

const initializeDatabase = (): void => {
    if (isInitialized && db) {
        return;
    }

    const supabaseUrl: string = EnvValidator('SUPABASE_URL') || '';
    const supabaseKey: string = EnvValidator('SUPABASE_ANON_KEY') || '';

    try {
        if (!supabaseUrl || !supabaseKey) {
            console.warn('Supabase credentials are missing. Using fallback client.');
            db = {
                from: () => createChainableFallback(),
                rpc: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
            };
        } else {
            db = createClient(supabaseUrl, supabaseKey);
            isInitialized = true;
        }
    } catch (error) {
        console.warn('Supabase client initialization failed. Using fallback client.');
        db = {
            from: () => createChainableFallback(),
            rpc: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
        };
    }
};

const getDatabase = (): any => {
    if (!isInitialized) {
        initializeDatabase();
    }
    return db;
};

if (!db) {
    db = {
        from: () => createChainableFallback(),
        rpc: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
    };
}

export default new Proxy({} as any, {
    get: (target, prop) => {
        const dbInstance = getDatabase();
        return dbInstance[prop];
    }
});

export const reinitializeDatabase = (): void => {
    isInitialized = false;
    db = null;
    initializeDatabase();
};
