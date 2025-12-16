import { createClient } from '@supabase/supabase-js';
import { EnvValidator } from '../EnvValidator';

const supabaseUrl: string = EnvValidator(`SUPABASE_URL`) || '';
const supabaseKey: string = EnvValidator(`SUPABASE_ANON_KEY`) || '';

let db: any = null;

try {
  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase credentials are missing. Using fallback client.');
  } else {
    db = createClient(supabaseUrl, supabaseKey);
  }
} catch (error) {
  console.warn('Supabase client initialization failed. Using fallback client.');
}

if (!db) {
  const fallbackMethods = {
    select: () => ({ data: null, error: new Error('Supabase client not initialized') }),
    insert: () => ({ data: null, error: new Error('Supabase client not initialized') }),
    update: () => ({ data: null, error: new Error('Supabase client not initialized') }),
    delete: () => ({ data: null, error: new Error('Supabase client not initialized') }),
    upsert: () => ({ data: null, error: new Error('Supabase client not initialized') }),
    order: () => ({ 
      limit: () => ({ data: null, error: new Error('Supabase client not initialized') }),
      select: () => ({ data: null, error: new Error('Supabase client not initialized') })
    }),
    limit: () => ({ data: null, error: new Error('Supabase client not initialized') }),
    range: () => ({ data: null, error: new Error('Supabase client not initialized') }),
    single: () => ({ data: null, error: new Error('Supabase client not initialized') }),
    maybeSingle: () => ({ data: null, error: new Error('Supabase client not initialized') }),
  };

  db = {
    from: () => fallbackMethods,
    rpc: () => ({ data: null, error: new Error('Supabase client not initialized') }),
  };
}

export default db;