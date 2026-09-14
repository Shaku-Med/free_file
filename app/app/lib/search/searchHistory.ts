// Search history kept on this device only. It is never sent to the server.

const STORAGE_KEY = "memories:search-history:v1";
const MAX_ENTRIES = 30;
const MAX_LENGTH = 80;

type Entry = { q: string; t: number };

function clean(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
}

// localStorage is editable by anything on the device, so every entry is
// re-validated rather than trusted.
function isEntry(v: unknown): v is Entry {
  if (!v || typeof v !== "object") return false;
  const e = v as { q?: unknown; t?: unknown };
  return (
    typeof e.q === "string" &&
    e.q.length > 0 &&
    e.q.length <= MAX_LENGTH &&
    typeof e.t === "number" &&
    Number.isFinite(e.t)
  );
}

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function write(entries: Entry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage full or blocked */
  }
}

export function getSearchHistory(limit = MAX_ENTRIES): string[] {
  return read()
    .sort((a, b) => b.t - a.t)
    .slice(0, limit)
    .map((e) => e.q);
}

export function addSearchHistory(query: string) {
  const q = clean(query);
  if (!q) return;
  const key = q.toLowerCase();
  const rest = read().filter((e) => e.q.toLowerCase() !== key);
  write([{ q, t: Date.now() }, ...rest]);
}

export function removeSearchHistory(query: string) {
  const key = clean(query).toLowerCase();
  write(read().filter((e) => e.q.toLowerCase() !== key));
}

// Prefix matches first, then matches at the start of a later word.
export function matchSearchHistory(term: string, limit: number): string[] {
  const t = clean(term).toLowerCase();
  if (!t) return [];
  const history = getSearchHistory();
  const prefix: string[] = [];
  const wordStart: string[] = [];
  for (const q of history) {
    const lower = q.toLowerCase();
    if (lower === t) continue;
    if (lower.startsWith(t)) prefix.push(q);
    else if (lower.includes(` ${t}`)) wordStart.push(q);
  }
  return [...prefix, ...wordStart].slice(0, limit);
}
