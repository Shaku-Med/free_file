import { pipeline, type ImageClassificationSingle, RawImage } from "@huggingface/transformers";
import { VKF } from "../../Video";

// Cache the pipeline instance to avoid reloading the model on every request
// This significantly improves performance and reduces memory churn
let cachedPipeline: any = null;
let pipelinePromise: Promise<any> | null = null;

const getPipeline = async () => {
  // Use preloaded pipeline from startWithPreload (avoids first-request freeze)
  const preloaded = (globalThis as unknown as { __NSFW_PIPELINE?: unknown }).__NSFW_PIPELINE;
  if (preloaded) return preloaded;

  // If pipeline is already cached, return it
  if (cachedPipeline) {
    return cachedPipeline;
  }

  // If pipeline is being created, wait for it
  if (pipelinePromise) {
    return pipelinePromise;
  }

  // Create new pipeline (fallback when not using startWithPreload, e.g. dev)
  pipelinePromise = pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector');
  cachedPipeline = await pipelinePromise;
  pipelinePromise = null;

  return cachedPipeline;
};

export const action = async ({ request }: { request: Request }) => {
  try {
    // Auth: X-Webhook-Secret (Go upload server) or VKF (user/browser)
    const secret = request.headers.get('X-Webhook-Secret') ?? '';
    const expected = typeof process !== 'undefined' ? process.env?.UPLOAD_WEBHOOK_SECRET : '';
    const serverAuth = !!(expected && secret === expected);
    const verified = serverAuth || (await VKF(request));
    if (!verified) return new Response(null, { status: 401 });
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Get the image file from FormData
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;

    if (!imageFile) {
      return new Response(
        JSON.stringify({ error: 'No image file provided' }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Convert file to RawImage format for transformers.js in Node.js
    // RawImage can handle Buffer/ArrayBuffer directly
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Create RawImage from buffer - this works in Node.js environment
    const image = await RawImage.fromBlob(new Blob([buffer], { type: imageFile.type || 'image/jpeg' }));
    
    // Run NSFW detection using Hugging Face transformers
    // Use cached pipeline instance to avoid reloading model on every request
    const pip = await getPipeline();
    const result = await pip(image);
    const isNSFW = (result as ImageClassificationSingle[])[0].label === 'nsfw';

    return new Response(
      JSON.stringify({ 
        success: true,
        nsfw: isNSFW 
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('NSFW detection error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'Something went wrong!',
        nsfw: false
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

export const loader = async ({ request }: { request: Request }) => {
    try {
        let verified = await VKF(request)
        if(!verified) return new Response(null, { status: 401 })
        return new Response(null, { status: 405 })
    }
    catch (error) {
        return new Response(null, { status: 500 })
    }
}