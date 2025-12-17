import { pipeline, type ImageClassificationSingle, RawImage } from '@huggingface/transformers';

let cachedPipeline: any = null;
let pipelinePromise: Promise<any> | null = null;

const getPipeline = async () => {
  if (cachedPipeline) {
    return cachedPipeline;
  }
  
  if (pipelinePromise) {
    return pipelinePromise;
  }
  
  pipelinePromise = pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector');
  cachedPipeline = await pipelinePromise;
  pipelinePromise = null;
  
  return cachedPipeline;
};

const preloadPipeline = () => {
  if (!cachedPipeline && !pipelinePromise) {
    pipelinePromise = pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector')
      .then((pipe) => {
        cachedPipeline = pipe;
        pipelinePromise = null;
        return pipe;
      })
      .catch((error) => {
        console.error('Failed to preload NSFW detection model:', error);
        pipelinePromise = null;
        return null;
      });
  }
};

preloadPipeline();

export class NSFWDetectionService {
  async detectNSFW(imageBuffer: Buffer, mimeType: string): Promise<boolean> {
    try {
      const image = await RawImage.fromBlob(
        new Blob([new Uint8Array(imageBuffer)], { type: mimeType || 'image/jpeg' })
      );
      
      const pip = await getPipeline();
      const result = await pip(image);
      const isNSFW = (result as ImageClassificationSingle[])[0].label === 'nsfw';
      
      return isNSFW;
    } catch (error) {
      console.error('NSFW detection error:', error);
      return false;
    }
  }
}
