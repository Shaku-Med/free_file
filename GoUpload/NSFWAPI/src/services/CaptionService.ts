import dotenv from 'dotenv';
dotenv.config();

/**
 * Vision-language captioner. Google Vision LABEL_DETECTION can only give us
 * single-word concepts ("Night", "Eye"), which is what produced the broken
 * descriptions on the upload row. This service runs a small VLM after the
 * label step to produce a real description PLUS canonical categories/tags
 * the feed personalization can key on.
 *
 * Provider: Groq llama vision (fast, generous free tier). API surface is
 * OpenAI-compatible so swapping providers later is a single env change away.
 *
 * Fails silently  caller must treat the caption as optional. We never throw
 * to the upload pipeline just because the caption hop failed.
 */

const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

/** Must match the categoryKeywords keys in GoUpload internal/worker/worker.go */
export const CANONICAL_CATEGORIES = [
  'Gaming', 'Music', 'Entertainment', 'Education', 'Technology', 'Sports',
  'News', 'Lifestyle', 'Anime', 'Film', 'Automotive', 'Art', 'Nature',
] as const;

const SINGLE_IMAGE_INTRO =
  'You are analyzing a single image uploaded to a video/image sharing platform.';
const GRID_INTRO =
  'You are analyzing a contact sheet: a grid of frames sampled in chronological order from ONE video. ' +
  'Treat the frames as the same video over time, not separate images. Describe what the VIDEO shows overall.';

function buildPrompt(isGrid: boolean): string {
  return `${isGrid ? GRID_INTRO : SINGLE_IMAGE_INTRO}
Reply with ONLY a JSON object, no markdown fences, in this exact shape:
{"description": "...", "categories": [...], "tags": [...]}
- description: 1-2 specific sentences about the main subject and what is happening${isGrid ? ' across the video' : ''}. Be concrete ("a man drifting a red BMW around a wet roundabout at night"), never abstract ("a video of a car"). Max 50 words.
- categories: 0-3 entries chosen ONLY from this list: ${CANONICAL_CATEGORIES.join(', ')}. Pick the ones that best fit; empty array if none fit.
- tags: 3-8 short lowercase keywords a viewer might search for (subjects, actions, style, setting).`;
}

const MAX_BASE64_BYTES = 8 * 1024 * 1024;
const MAX_CAPTION_LEN = 400;
const MAX_TAGS = 8;
const MAX_CATEGORIES = 3;

export interface CaptionResult {
  description: string;
  categories: string[];
  tags: string[];
}

export interface CaptionConfig {
  apiKeys: string[];
  model: string;
  endpoint: string;
  timeoutMs: number;
}

function loadConfig(): CaptionConfig | null {
  const keysStr = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '').trim();
  if (!keysStr) return null;
  const apiKeys = keysStr.split(',').map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) return null;
  return {
    apiKeys,
    model: process.env.GROQ_VISION_MODEL?.trim() || DEFAULT_MODEL,
    endpoint:
      process.env.GROQ_VISION_ENDPOINT?.trim() ||
      'https://api.groq.com/openai/v1/chat/completions',
    timeoutMs: Number(process.env.GROQ_VISION_TIMEOUT_MS) || 12_000,
  };
}

function sanitize(text: string): string {
  let out = String(text || '').trim();
  out = out.replace(/^["'`]+|["'`]+$/g, '');
  out = out.replace(/\s+/g, ' ');
  if (out.length > MAX_CAPTION_LEN) out = out.slice(0, MAX_CAPTION_LEN).trim();
  return out;
}

const canonicalByLower = new Map<string, string>(
  CANONICAL_CATEGORIES.map((c) => [c.toLowerCase(), c])
);

function sanitizeStringArray(value: unknown, max: number, lowercase: boolean): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    let v = item.trim().replace(/\s+/g, ' ');
    if (lowercase) v = v.toLowerCase();
    if (!v || v.length > 64) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Parse the VLM reply into a CaptionResult. Tolerates markdown fences and
 * stray prose around the JSON; falls back to treating the whole reply as a
 * plain description when no valid JSON is found.
 */
export function parseCaptionResponse(raw: string): CaptionResult {
  const text = String(raw || '').trim();
  const empty: CaptionResult = { description: '', categories: [], tags: [] };
  if (!text) return empty;

  // Pull the first {...} block (handles ```json fences and leading prose)
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const description = sanitize(typeof parsed.description === 'string' ? parsed.description : '');
      const categories = sanitizeStringArray(parsed.categories, MAX_CATEGORIES, false)
        .map((c) => canonicalByLower.get(c.toLowerCase()))
        .filter((c): c is string => !!c);
      const tags = sanitizeStringArray(parsed.tags, MAX_TAGS, true);
      if (description || categories.length > 0 || tags.length > 0) {
        return { description, categories, tags };
      }
    } catch {
      // fall through to plain-text fallback
    }
  }

  return { description: sanitize(text), categories: [], tags: [] };
}

export class CaptionService {
  private cfg: CaptionConfig | null;

  constructor() {
    this.cfg = loadConfig();
    if (!this.cfg) {
      process.stdout.write(
        '[CaptionService] GROQ_API_KEYS not set  captions will be skipped.\n',
      );
    } else {
      process.stdout.write(
        `[CaptionService] Loaded ${this.cfg.apiKeys.length} key(s), model=${this.cfg.model}\n`,
      );
    }
  }

  isEnabled(): boolean {
    return this.cfg !== null;
  }

  async caption(imageBase64: string, isGrid = false): Promise<CaptionResult | null> {
    if (!this.cfg) return null;
    if (!imageBase64 || imageBase64.length > MAX_BASE64_BYTES) return null;

    const cfg = this.cfg;
    const maxAttempts = Math.min(2, cfg.apiKeys.length);
    const tried = new Set<number>();
    for (let i = 0; i < maxAttempts; i++) {
      let idx: number;
      do {
        idx = Math.floor(Math.random() * cfg.apiKeys.length);
      } while (tried.has(idx) && tried.size < cfg.apiKeys.length);
      tried.add(idx);
      try {
        const raw = await this.callProvider(cfg.apiKeys[idx], imageBase64, cfg, isGrid);
        const parsed = parseCaptionResponse(raw);
        if (parsed.description || parsed.categories.length > 0 || parsed.tags.length > 0) {
          return parsed;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[CaptionService] attempt ${i + 1} key#${idx} failed: ${msg}\n`);
      }
    }
    return null;
  }

  private async callProvider(
    apiKey: string,
    imageBase64: string,
    cfg: CaptionConfig,
    isGrid: boolean,
  ): Promise<string> {
    const dataUrl = `data:image/jpeg;base64,${imageBase64}`;
    const body = {
      model: cfg.model,
      max_tokens: 220,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(isGrid) },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json?.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}
