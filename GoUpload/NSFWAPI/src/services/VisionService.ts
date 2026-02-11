import dotenv from 'dotenv';
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
}

const NSFW_ADULT = new Set(['LIKELY', 'VERY_LIKELY']);
const NSFW_HIGH = new Set(['VERY_LIKELY']);

export class VisionService {
  private apiKeys: string[];

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
    process.stdout.write(
      `[VisionService] Loaded ${this.apiKeys.length} API key(s)\n`
    );
  }

  private getRandomKey(): string {
    return this.apiKeys[Math.floor(Math.random() * this.apiKeys.length)];
  }

  async detect(imageBase64: string): Promise<DetectionResult> {
    console.log(`[VisionService] detect() called | base64 length: ${imageBase64.length}`);
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

    let isNSFW = false;
    if (ss) {
      isNSFW =
        NSFW_ADULT.has(ss.adult) ||
        NSFW_HIGH.has(ss.racy) ||
        NSFW_HIGH.has(ss.violence);
    }
    console.log(`[VisionService] isNSFW decision: ${isNSFW} (adult=${ss?.adult}, racy=${ss?.racy}, violence=${ss?.violence})`);

    const labels = (result.labelAnnotations ?? []).map((l) => ({
      name: l.description,
      score: Math.round(l.score * 100) / 100,
    }));

    if (labels.length > 0) {
      console.log(`[VisionService] Top labels:`, labels.slice(0, 5).map(l => `${l.name}(${l.score})`).join(', '));
    }

    const relevantLabels = labels.filter((l) => l.score >= 0.50).map((l) => l.name.toLowerCase());
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
    };
  }
}
