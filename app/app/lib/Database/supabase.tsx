import { createClient } from '@supabase/supabase-js';
import { EnvValidator } from '../EnvValidator';

// Server-only: EnvValidator reads env at runtime on the server. Do not import this module
// from client-only entrypoints that ship to the browser.
// SUPABASE_ANON_KEY is a legacy env name; the value is your server secret (e.g. service_role JWT).
const supabaseUrl: string = EnvValidator(`SUPABASE_URL`) || '';
const supabaseKey: string = EnvValidator(`SUPABASE_ANON_KEY`) || '';

let db: any = null;

try {
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'FATAL: Supabase credentials missing (SUPABASE_URL / SUPABASE_ANON_KEY). Every query will fail.',
    );
  } else {
    db = createClient(supabaseUrl, supabaseKey);
  }
} catch (error) {
  // Surface the REAL cause. This used to log a generic line, which hid a
  // genuine outage: supabase-js needs a global WebSocket (Node 22+), so on an
  // older runtime createClient() throws here and every query then failed with
  // the misleading "Supabase client not initialized" from the stub below.
  console.error('FATAL: Supabase client initialization failed:', error);
}

if (!db) {
  // Create a chainable fallback that supports method chaining
  const createChainableFallback = () => {
    const errorResponse = { data: null, error: new Error('Supabase client not initialized') };
    const errorPromise = Promise.resolve(errorResponse);
    
    // Create a chainable object that supports all Supabase query methods
    // The object itself is awaitable (thenable) and also has chainable methods
    const createChainable = (): any => {
      const chainable: any = {
        // Chainable methods
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
        // Terminal methods that return promises
        single: () => errorPromise,
        maybeSingle: () => errorPromise,
      };
      
      // Make the chainable object itself awaitable (thenable)
      chainable.then = errorPromise.then.bind(errorPromise);
      chainable.catch = errorPromise.catch.bind(errorPromise);
      chainable.finally = errorPromise.finally?.bind(errorPromise);
      
      return chainable;
    };
    
    return createChainable();
  };

  db = {
    from: () => createChainableFallback(),
    rpc: () => Promise.resolve({ data: null, error: new Error('Supabase client not initialized') }),
  };
}

export default db;