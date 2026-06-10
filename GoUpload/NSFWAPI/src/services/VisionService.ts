import dotenv from 'dotenv';
import { CaptionService } from './CaptionService.js';
dotenv.config();

interface SafeSearchAnnotation {
  adult: string;
  spoof: string;
  medical: string;
  violence: string;
  racy: string;
}

interface LabelAnnotation {
  mid: string;
  description: string;
  score: number;
  topicality: number;
}

interface VisionAPIResponse {
  responses: Array<{
    safeSearchAnnotation?: SafeSearchAnnotation;
    labelAnnotations?: LabelAnnotation[];
    error?: { code: number; message: string };
  }>;
}

export interface DetectionResult {
  isNSFW: boolean;
  description: string;
  safeSearch: {
    adult: string;
    violence: string;
    racy: string;
    spoof: string;
    medical: string;
  } | null;
  labels: Array<{ name: string; score: number }>;
  /** VLM-picked categories from the canonical taxonomy (feed personalization keys on these) */
  suggestedCategories: string[];
  /** VLM-picked searchable keywords */
  suggestedTags: string[];
}

const NSFW_ADULT = new Set(['LIKELY', 'VERY_LIKELY']);
const NSFW_HIGH = new Set(['VERY_LIKELY']);

// Labels that indicate harmful/violent/gory content  flag as NSFW even if SafeSearch misses them
const HARMFUL_LABELS = new Set([
  'blood', 'gore', 'wound', 'injury', 'corpse', 'dead body', 'murder',
  'killing', 'stabbing', 'gunshot', 'shooting', 'decapitation', 'mutilation',
  'torture', 'self-harm', 'suicide', 'drug use', 'drug paraphernalia',
  'graphic violence', 'animal cruelty', 'child abuse', 'terrorism',
  'extremism', 'hate symbol', 'war crime',
]);

// Labels that indicate the content is performance/fashion/beach context  NOT adult
const SAFE_CONTEXT_LABELS = new Set([
  'music', 'music video', 'concert', 'performance', 'singer', 'dancer',
  'dance', 'choreography', 'stage', 'swimming', 'swimwear', 'bikini',
  'beach', 'pool', 'resort', 'vacation', 'fitness', 'workout', 'exercise',
  'sport', 'athlete', 'model', 'fashion', 'runway', 'photoshoot',
  'entertainment', 'festival', 'party', 'celebration',
]);

export class VisionService {
  private apiKeys: string[];
  private captioner: CaptionService;

  constructor() {
    const keysStr = process.env.GOOGLE_VISION_API_KEYS || '';
    this.apiKeys = keysStr
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    if (this.apiKeys.length === 0) {
      throw new Error(
        'No Google Vision API keys configured. Set GOOGLE_VISION_API_KEYS in .env (comma-separated).'
      );
    }
    this.captioner = new CaptionService();
    process.stdout.write(
      `[VisionService] Loaded ${this.apiKeys.length} API key(s)\n`
    );
  }

  private getRandomKey(): string {
    return this.apiKeys[Math.floor(Math.random() * this.apiKeys.length)];
  }

  async detect(imageBase64: string, isGrid = false): Promise<DetectionResult> {
    console.log(`[VisionService] detect() called | base64 length: ${imageBase64.length} | isGrid: ${isGrid}`);
    const maxAttempts = Math.min(3, this.apiKeys.length);
    const tried = new Set<number>();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let idx: number;
      do {
        idx = Math.floor(Math.random() * this.apiKeys.length);
      } while (tried.has(idx) && tried.size < this.apiKeys.length);
      tried.add(idx);

      try {
        console.log(`[VisionService] Attempt ${attempt + 1}/${maxAttempts} using key #${idx} (${this.apiKeys[idx].slice(0, 10)}...)`);
        const result = await this.callVisionAPI(this.apiKeys[idx], imageBase64);
        // Caption pass runs in parallel-friendly order: vision first (cheap, blocks
        // NSFW gate), then VLM. If VLM fails we keep the label-based fallback.
        if (this.captioner.isEnabled()) {
          const caption = await this.captioner.caption(imageBase64, isGrid);
          if (caption) {
            if (caption.description) result.description = caption.description;
            result.suggestedCategories = caption.categories;
            result.suggestedTags = caption.tags;
          }
        }
        console.log(`[VisionService] SUCCESS on attempt ${attempt + 1}`);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`[VisionService] Attempt ${attempt + 1}/${maxAttempts} FAILED (key #${idx}): ${lastError.message}`);
      }
    }

    throw lastError || new Error('Vision API detection failed');
  }

  private async callVisionAPI(
    apiKey: string,
    imageBase64: string
  ): Promise<DetectionResult> {
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    const body = {
      requests: [
        {
          image: { content: imageBase64 },
          features: [
            { type: 'SAFE_SEARCH_DETECTION' },
            { type: 'LABEL_DETECTION', maxResults: 20 },
          ],
        },
      ],
    };

    console.log(`[VisionService] Calling Google Vision API...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log(`[VisionService] Google API HTTP status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[VisionService] Google API error body: ${text.slice(0, 500)}`);
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as VisionAPIResponse;
    const result = data.responses?.[0];

    if (!result) {
      console.error('[VisionService] Empty response array from Vision API');
      throw new Error('Empty response from Vision API');
    }
    if (result.error) {
      console.error(`[VisionService] Vision API error in response: ${result.error.code} - ${result.error.message}`);
      throw new Error(
        `Vision API error ${result.error.code}: ${result.error.message}`
      );
    }

    const ss = result.safeSearchAnnotation ?? null;
    console.log(`[VisionService] SafeSearch:`, ss ? JSON.stringify(ss) : 'null');
    console.log(`[VisionService] Labels count: ${result.labelAnnotations?.length ?? 0}`);

    const labels = (result.labelAnnotations ?? []).map((l) => ({
      name: l.description,
      score: Math.round(l.score * 100) / 100,
    }));

    if (labels.length > 0) {
      console.log(`[VisionService] Top labels:`, labels.slice(0, 5).map(l => `${l.name}(${l.score})`).join(', '));
    }

    const relevantLabels = labels.filter((l) => l.score >= 0.50).map((l) => l.name.toLowerCase());

    // Check if labels indicate safe performance/fashion/beach context
    const hasSafeContext = relevantLabels.some((l) => SAFE_CONTEXT_LABELS.has(l));
    // Check if labels indicate harmful/gory content
    const hasHarmfulLabels = relevantLabels.some((l) => HARMFUL_LABELS.has(l));

    let isNSFW = false;
    let flagReason = '';

    if (ss) {
      // 1. Explicit adult content  always flag
      if (NSFW_ADULT.has(ss.adult)) {
        isNSFW = true;
        flagReason = 'adult content';
      }

      // 2. Racy content  only flag if there's NO safe context (fixes bikini false positives)
      if (!isNSFW && NSFW_HIGH.has(ss.racy) && !hasSafeContext) {
        isNSFW = true;
        flagReason = 'racy content without safe context';
      }

      // 3. Violence  flag LIKELY and above (lowered from VERY_LIKELY to catch more harmful content)
      if (!isNSFW && NSFW_ADULT.has(ss.violence)) {
        isNSFW = true;
        flagReason = 'violent content';
      }

      // 4. Graphic medical content
      if (!isNSFW && NSFW_HIGH.has(ss.medical)) {
        isNSFW = true;
        flagReason = 'graphic medical content';
      }
    }

    // 5. Label-based harmful content detection (catches gore/blood even if SafeSearch misses it)
    if (!isNSFW && hasHarmfulLabels) {
      const matched = relevantLabels.filter((l) => HARMFUL_LABELS.has(l));
      isNSFW = true;
      flagReason = `harmful labels: ${matched.join(', ')}`;
    }

    console.log(`[VisionService] isNSFW decision: ${isNSFW} (reason=${flagReason || 'none'}, adult=${ss?.adult}, racy=${ss?.racy}, violence=${ss?.violence}, medical=${ss?.medical}, safeContext=${hasSafeContext}, harmfulLabels=${hasHarmfulLabels})`);

    const description = relevantLabels.length > 0
      ? `Content featuring ${relevantLabels.join(', ')}`
      : '';
    console.log(`[VisionService] Generated description: "${description}"`);

    return {
      isNSFW,
      description,
      safeSearch: ss
        ? {
            adult: ss.adult,
            violence: ss.violence,
            racy: ss.racy,
            spoof: ss.spoof,
            medical: ss.medical,
          }
        : null,
      labels,
      suggestedCategories: [],
      suggestedTags: [],
    };
  }
}
