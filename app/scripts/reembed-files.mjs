// Model-swap migration: re-embed EVERY file with the multilingual model and
// backfill content_language. Vectors from the old English-only model and the
// new multilingual one are not comparable, so after deploying the new EmbedAPI
// image this must run once over the whole catalog (backfill-embeddings.mjs only
// fills NULLs and is not enough here).
//
// Re-runnable and resumable: rows are walked oldest-first by created_at; pass
// START_AFTER=<iso timestamp> to continue from where a previous run stopped
// (the script logs the cursor as it goes).
//
// Usage:  node scripts/reembed-files.mjs
// Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//         UPLOAD_SERVER_URL (or GO_UPLOAD_URL), UPLOAD_WEBHOOK_SECRET,
//         START_AFTER (optional ISO timestamp cursor)
import { createClient } from '@supabase/supabase-js';
import { franc } from 'franc-min';

const SUPABASE_URL = process.env.SUPABASE_URL;
// SUPABASE_ANON_KEY is the app's legacy env name for its SERVER key (see
// lib/Database/supabase.tsx) - accepted here so the script runs with the
// container's own .env untouched.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const UPLOAD_BASE = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || '').replace(/\/$/, '');
const SECRET = process.env.UPLOAD_WEBHOOK_SECRET;

const PAGE_SIZE = 200;
const BATCH_SIZE = 16;
const BATCH_PAUSE_MS = 250;

if (!SUPABASE_URL || !SUPABASE_KEY || !UPLOAD_BASE || !SECRET) {
  console.error('Missing env: need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY), UPLOAD_SERVER_URL (or GO_UPLOAD_URL), UPLOAD_WEBHOOK_SECRET');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirrors the Go worker's embedForFile text composition.
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

// Mirrors GoUpload lib/langdetect: uploader's own words only (never the AI
// caption - it is always English), ISO 639-3, empty when too short/unsure.
function detectLanguage(file) {
  const text = [file.file_title, file.file_description]
    .filter((s) => typeof s === 'string' && s.trim())
    .join(' ')
    .trim();
  const letters = text.replace(/[\s0-9.,!?#\-_()[\]{}|/\\:;'"+&@%*=~]/g, '').length;
  if (letters < 12) return '';
  const code = franc(text, { minLength: 12 });
  return code && code !== 'und' && /^[a-z]{2,3}$/.test(code) ? code : '';
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

let cursor = process.env.START_AFTER || '1970-01-01T00:00:00Z';
let embedded = 0;
let langsSet = 0;
let failed = 0;

for (;;) {
  const { data: rows, error } = await db
    .from('files')
    .select('unique_id, created_at, filename, file_title, file_description, tags, categories, metadata, content_language')
    .eq('upload_status', 'complete')
    .gt('created_at', cursor)
    .order('created_at', { ascending: true })
    .limit(PAGE_SIZE);

  if (error) {
    console.error('select failed:', error.message ?? error);
    process.exit(1);
  }
  if (!rows || rows.length === 0) break;

  cursor = rows[rows.length - 1].created_at;

  const candidates = rows
    .map((f) => ({ file: f, uniqueId: f.unique_id, text: buildText(f) }))
    .filter((c) => c.uniqueId && c.text);

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    try {
      const vectors = await embedBatch(batch.map((b) => b.text));
      for (let j = 0; j < batch.length; j++) {
        const { uniqueId, file } = batch[j];
        const { error: rpcErr } = await db.rpc('set_file_embedding', {
          p_unique_id: uniqueId,
          p_embedding: `[${vectors[j].join(',')}]`,
        });
        if (rpcErr) {
          failed++;
          console.warn(`set_file_embedding ${uniqueId}:`, rpcErr.message ?? rpcErr);
          continue;
        }
        embedded++;

        const lang = detectLanguage(file);
        if (lang && file.content_language !== lang) {
          const { error: langErr } = await db
            .from('files')
            .update({ content_language: lang })
            .eq('unique_id', uniqueId);
          if (langErr) console.warn(`content_language ${uniqueId}:`, langErr.message ?? langErr);
          else langsSet++;
        }
      }
    } catch (e) {
      failed += batch.length;
      console.warn('batch failed:', e.message ?? e);
    }
    await sleep(BATCH_PAUSE_MS);
  }
  console.log(`progress: embedded=${embedded} langs=${langsSet} failed=${failed} cursor=${cursor}`);
}

console.log(`done. embedded=${embedded} langs=${langsSet} failed=${failed}`);
