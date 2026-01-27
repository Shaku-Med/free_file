import { pipeline, type ImageClassificationSingle, RawImage } from '@huggingface/transformers';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';

let cachedPipeline: any = null;
let pipelinePromise: Promise<any> | null = null;
let preloadAttempted = false;

const clearModelCache = () => {
  try {
    const possibleCacheDirs = [
      join(process.cwd(), 'node_modules', '@huggingface', 'transformers.cache'),
      join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache'),
    ];
    
    for (const cacheDir of possibleCacheDirs) {
      if (existsSync(cacheDir)) {
        const modelCachePath = join(cacheDir, 'AdamCodd', 'vit-base-nsfw-detector');
        if (existsSync(modelCachePath)) {
          console.log('[NSFW Detection] Clearing corrupted model cache at:', modelCachePath);
          rmSync(modelCachePath, { recursive: true, force: true });
          console.log('[NSFW Detection] Cache cleared successfully');
          return;
        }
        
        const altModelCachePath = join(cacheDir, 'AdamCodd', 'vitbasensfw');
        if (existsSync(altModelCachePath)) {
          console.log('[NSFW Detection] Clearing corrupted model cache at:', altModelCachePath);
          rmSync(altModelCachePath, { recursive: true, force: true });
          console.log('[NSFW Detection] Cache cleared successfully');
          return;
        }
      }
    }
    
    console.warn('[NSFW Detection] Cache directory not found, model will be re-downloaded');
  } catch (error) {
    console.warn('[NSFW Detection] Failed to clear cache:', error);
  }
};

const getPipeline = async (retryCount: number = 0): Promise<any> => {
  if (cachedPipeline) {
    return cachedPipeline;
  }
  
  if (pipelinePromise) {
    return pipelinePromise;
  }
  
  const maxRetries = 2;
  
  pipelinePromise = (async () => {
    try {
      const pipe = await pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector');
      cachedPipeline = pipe;
      pipelinePromise = null;
      return pipe;
    } catch (error: any) {
      pipelinePromise = null;
      
      if (error?.message?.includes('protobuf') || error?.message?.includes('parsing failed')) {
        if (retryCount < maxRetries) {
          console.warn(`[NSFW Detection] Model load failed (attempt ${retryCount + 1}/${maxRetries}), clearing cache and retrying...`);
          clearModelCache();
          return getPipeline(retryCount + 1);
        } else {
          console.error('[NSFW Detection] Failed to load model after retries:', error);
          throw error;
        }
      }
      
      throw error;
    }
  })();
  
  return pipelinePromise;
};

const preloadPipeline = async () => {
  if (preloadAttempted) {
    return;
  }
  
  preloadAttempted = true;
  
  if (!cachedPipeline && !pipelinePromise) {
    getPipeline()
      .then((pipe) => {
        if (pipe) {
          console.log('[NSFW Detection] Model preloaded successfully');
        }
      })
      .catch((error) => {
        console.error('[NSFW Detection] Failed to preload model (will retry on first use):', error.message || error);
      });
  }
};

setTimeout(() => {
  preloadPipeline();
}, 5000);

export class NSFWDetectionService {
  private readonly NSFW_THRESHOLD = 0.15;

  async detectNSFW(imageBuffer: Buffer, mimeType: string): Promise<boolean> {
    try {
      const image = await RawImage.fromBlob(
        new Blob([new Uint8Array(imageBuffer)], { type: mimeType || 'image/jpeg' })
      );
      
      const pip = await getPipeline();
      const results = await pip(image) as ImageClassificationSingle[];
      
      if (!results || results.length === 0) {
        return false;
      }

      const nsfwResult = results.find(r => r.label.toLowerCase() === 'nsfw');
      const topResult = results[0];

      if (nsfwResult && nsfwResult.score >= this.NSFW_THRESHOLD) {
        return true;
      }

      if (topResult.label.toLowerCase() === 'nsfw' && topResult.score >= this.NSFW_THRESHOLD) {
        return true;
      }

      if (topResult.label.toLowerCase() === 'nsfw') {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('NSFW detection error:', error);
      return false;
    }
  }
}
