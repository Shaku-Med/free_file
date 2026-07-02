// One-time backfill: embed every already-uploaded file for semantic search.
// Re-runnable  only touches rows where embedding IS NULL, so you can stop
// and resume freely. New uploads embed automatically via the worker webhook.
//
// Usage:  node scripts/backfill-embeddings.mjs
// Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//         UPLOAD_SERVER_URL (or GO_UPLOAD_URL), UPLOAD_WEBHOOK_SECRET
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
// SUPABASE_ANON_KEY is the app's legacy env name for its SERVER key.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const UPLOAD_BASE = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || '').replace(/\/$/, '');
const SECRET = process.env.UPLOAD_WEBHOOK_SECRET;

const PAGE_SIZE = 200;
const BATCH_SIZE = 16;
const BATCH_PAUSE_MS = 250;

if (!SUPABASE_URL || !SUPABASE_KEY || !UPLOAD_BASE || !SECRET) {
  console.error('Missing env: need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UPLOAD_SERVER_URL, UPLOAD_WEBHOOK_SECRET');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildText(file) {
  const parts = [];
  if (file.file_title?.trim()) parts.push(file.file_title.trim());
  if (file.file_description?.trim()) parts.push(file.file_description.trim());
  const aiDesc = file.metadata?.description;
  if (typeof aiDesc === 'string' && aiDesc.trim()) parts.push(aiDesc.trim());
  if (Array.isArray(file.categories) && file.categories.length) parts.push(file.categories.join(' '));
  if (Array.isArray(file.tags) && file.tags.length) parts.push(file.tags.join(' '));
  if (parts.length === 0 && file.filename) parts.push(file.filename);
  return parts.join('. ').slice(0, 2000).trim();
}

async function embedBatch(texts) {
  const res = await fetch(`${UPLOAD_BASE}/internal/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': SECRET },
    body: JSON.stringify({ texts, kind: 'passage' }),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.vectors) || json.vectors.length !== texts.length) {
    throw new Error('embed response shape mismatch');
  }
  return json.vectors;
}

let total = 0;
let failed = 0;

for (;;) {
  const { data: rows, error } = await db
    .from('files')
    .select('unique_id, filename, file_title, file_description, tags, categories, metadata')
    .is('embedding', null)
    .eq('upload_status', 'complete')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    console.error('select failed:', error.message ?? error);
    process.exit(1);
  }
  if (!rows || rows.length === 0) break;

  const candidates = rows
    .map((f) => ({ uniqueId: f.unique_id, text: buildText(f) }))
    .filter((c) => c.uniqueId && c.text);

  // Rows with no usable text would be re-selected forever; skip the page if
  // everything was empty (operator can inspect those manually).
  if (candidates.length === 0) {
    console.warn(`page had ${rows.length} rows but zero embeddable texts - stopping to avoid a loop`);
    break;
  }

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    try {
      const vectors = await embedBatch(batch.map((b) => b.text));
      for (let j = 0; j < batch.length; j++) {
        const { error: rpcErr } = await db.rpc('set_file_embedding', {
          p_unique_id: batch[j].uniqueId,
          p_embedding: `[${vectors[j].join(',')}]`,
        });
        if (rpcErr) {
          failed++;
          console.warn(`set_file_embedding ${batch[j].uniqueId}:`, rpcErr.message ?? rpcErr);
        } else {
          total++;
        }
      }
    } catch (e) {
      failed += batch.length;
      console.warn('batch failed:', e.message ?? e);
    }
    await sleep(BATCH_PAUSE_MS);
  }
  console.log(`progress: ${total} embedded, ${failed} failed`);
}

console.log(`done. embedded=${total} failed=${failed}`);
