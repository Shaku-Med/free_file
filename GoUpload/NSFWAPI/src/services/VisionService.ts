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
  /**
   * WHICH kind of problem, not just that there is one.
   *
   * 'adult'   sexual / racy. Downstream: unlisted, reachable by link.
   * 'harmful' gore, violence, graphic medical. Downstream: private until a
   *           human clears it.
   * null      clean.
   *
   * This exists because a single isNSFW boolean cannot express the difference,
   * and the two need opposite handling. The reason string was already computed
   * here and then thrown away.
   */
  category: 'adult' | 'harmful' | null;
  /** Human readable explanation of the category, for review screens. */
  flagReason: string;
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

// A file waits on the gore check while it processes, so it gets a bounded
// time; running out leaves the file private rather than refused.
const GORE_CHECK_BUDGET_MS = 50_000;

export type Verdict = Pick<DetectionResult, 'isNSFW' | 'category' | 'flagReason'>;

/**
 * Harmful is judged on its own and outranks adult. Checking adult first used
 * to stop at "racy" on a gory photo that also showed skin, so it went out as
 * a mere 18+ and its VERY_LIKELY violence was never looked at.
 */
export function classify(
  ss: SafeSearchAnnotation | null,
  relevantLabels: string[],
  gateOnly: boolean,
): Verdict {
  const harmfulLabels = gateOnly ? [] : relevantLabels.filter((l) => HARMFUL_LABELS.has(l));
  let harmful = '';
  if (ss && NSFW_ADULT.has(ss.violence)) harmful = 'violent content';
  else if (ss && NSFW_HIGH.has(ss.medical)) harmful = 'graphic medical content';
  else if (harmfulLabels.length > 0) harmful = `harmful labels: ${harmfulLabels.join(', ')}`;
  if (harmful) return { isNSFW: true, category: 'harmful', flagReason: harmful };

  const safeContext = relevantLabels.some((l) => SAFE_CONTEXT_LABELS.has(l));
  let adult = '';
  if (ss && NSFW_ADULT.has(ss.adult)) adult = 'adult content';
  // Racy needs labels to tell beach or fashion from explicit, so gate-only
  // frames leave it to the full grid pass. Bikinis were the false positives.
  else if (ss && !gateOnly && NSFW_HIGH.has(ss.racy) && !safeContext) {
    adult = 'racy content without safe context';
  }
  if (adult) return { isNSFW: true, category: 'adult', flagReason: adult };

  return { isNSFW: false, category: null, flagReason: '' };
}

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

  /**
   * Whether any of the images behind a harmful verdict shows graphic gore.
   * Throws when one gets no clear answer, so the caller keeps the file private.
   */
  async confirmGore(imagesBase64: string[]): Promise<boolean> {
    if (!this.captioner.isEnabled()) throw new Error('vision model not configured');
    const deadline = Date.now() + GORE_CHECK_BUDGET_MS;
    for (const image of imagesBase64) {
      if (await this.captioner.isGore(image, deadline)) return true;
    }
    return false;
  }

  async detect(imageBase64: string, isGrid = false, gateOnly = false): Promise<DetectionResult> {
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
        console.log(`[VisionService] Attempt ${attempt + 1}/${maxAttempts} using key #${idx}`);
        const result = await this.callVisionAPI(this.apiKeys[idx], imageBase64, gateOnly);
        // Gate-only frame checks skip the VLM caption (and Label Detection) to
        // save cost and latency; the full grid pass supplies description/tags.
        if (!gateOnly && this.captioner.isEnabled()) {
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
    imageBase64: string,
    gateOnly = false
  ): Promise<DetectionResult> {
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    // Gate-only: SafeSearch alone (one billed unit). Full: also Label Detection
    // (two units) for the safe-context and harmful-label checks below.
    const features = gateOnly
      ? [{ type: 'SAFE_SEARCH_DETECTION' }]
      : [{ type: 'SAFE_SEARCH_DETECTION' }, { type: 'LABEL_DETECTION', maxResults: 20 }];

    const body = {
      requests: [
        {
          image: { content: imageBase64 },
          features,
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
    const { isNSFW, category, flagReason } = classify(ss, relevantLabels, gateOnly);

    console.log(`[VisionService] decision: ${category ?? 'clean'} (reason=${flagReason || 'none'}, adult=${ss?.adult}, racy=${ss?.racy}, violence=${ss?.violence}, medical=${ss?.medical})`);

    const description = relevantLabels.length > 0
      ? `Content featuring ${relevantLabels.join(', ')}`
      : '';
    console.log(`[VisionService] Generated description: "${description}"`);

    return {
      isNSFW,
      category,
      flagReason,
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
