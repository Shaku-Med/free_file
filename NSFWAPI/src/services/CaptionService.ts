import dotenv from 'dotenv';
dotenv.config();

/**
 * Vision-language captioner. Google Vision LABEL_DETECTION can only give us
 * single-word concepts ("Night", "Eye"), which is what produced the broken
 * descriptions on the upload row. This service runs a small VLM after the
 * label step to produce a real sentence like "a cat sitting on a table".
 *
 * Provider: Groq llama vision (fast, generous free tier). API surface is
 * OpenAI-compatible so swapping providers later is a single env change away.
 *
 * Fails silently  caller must treat caption as optional. We never throw to
 * the upload pipeline just because the caption hop failed.
 */

const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const PROMPT =
  'Describe this image naturally, like you are telling a friend what you see. One or two sentences: the main subject, what they are doing, and the setting (e.g. "A woman standing on an outdoor staircase, holding the railing and posing for a photo"). Be concrete and specific, never a list of words, never abstract. 40 words maximum. Return only the description.';

const MAX_BASE64_BYTES = 8 * 1024 * 1024;
const MAX_CAPTION_LEN = 300;

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

  async caption(imageBase64: string): Promise<string> {
    if (!this.cfg) return '';
    if (!imageBase64 || imageBase64.length > MAX_BASE64_BYTES) return '';

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
        return await this.callProvider(cfg.apiKeys[idx], imageBase64, cfg);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[CaptionService] attempt ${i + 1} key#${idx} failed: ${msg}\n`);
      }
    }
    return '';
  }

  private async callProvider(
    apiKey: string,
    imageBase64: string,
    cfg: CaptionConfig,
  ): Promise<string> {
    const dataUrl = `data:image/jpeg;base64,${imageBase64}`;
    const body = {
      model: cfg.model,
      max_tokens: 80,
      temperature: 0.4,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
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
      const text = json?.choices?.[0]?.message?.content ?? '';
      return sanitize(text);
    } finally {
      clearTimeout(timer);
    }
  }
}
