import { createCanvas, loadImage } from 'canvas';
import db from '~/lib/Database/supabase';
import { canAccessFile } from '~/routes/Api/fun/accessControl';

const applyBlur = (canvas: any, blurRadius: number = 50): void => {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  const radius = Math.min(blurRadius, 100);
  const passes = 3;
  
  for (let pass = 0; pass < passes; pass++) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const tempData = new Uint8ClampedArray(data);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, count = 0;
        
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = Math.max(0, Math.min(width - 1, x + dx));
            const ny = Math.max(0, Math.min(height - 1, y + dy));
            const idx = (ny * width + nx) * 4;
            r += tempData[idx];
            g += tempData[idx + 1];
            b += tempData[idx + 2];
            count++;
          }
        }
        
        const idx = (y * width + x) * 4;
        data[idx] = Math.floor(r / count);
        data[idx + 1] = Math.floor(g / count);
        data[idx + 2] = Math.floor(b / count);
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }
  
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, width, height);
};

const loadImageWithRetry = async (splitUrl: string, qualityParam: string | null, shouldBlur: boolean = false): Promise<Response> => {
    const tryLoadImage = async (urlPath: string): Promise<Response> => {
        const videoUrl = `https://github.com/${process.env.GITHUB_OWNER}/Memories/raw/main/${urlPath}`;
        const response = await fetch(videoUrl);
    
        if (!response.ok) throw new Error('Fetch failed');
    
        const imageBuffer = await response.arrayBuffer();
        const image = await loadImage(Buffer.from(imageBuffer));
        
        let scale = 1;
        
        if (qualityParam) {
            const qualityNum = parseFloat(qualityParam);
            if (!isNaN(qualityNum)) {
                if (qualityNum > 0 && qualityNum < 1) {
                    scale = qualityNum;
                } else if (qualityNum >= 1 && qualityNum <= 100) {
                    scale = qualityNum / 100;
                }
            }
        }

        const canvas = createCanvas(
            Math.round(image.width * scale),
            Math.round(image.height * scale)
        );
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        
        if (shouldBlur) {
          applyBlur(canvas, 80);
        }
        
        const processedBuffer = canvas.toBuffer('image/png');

        return new Response(new Uint8Array(processedBuffer), {
            status: 200,
            headers: {
                'Content-Type': `image/png`,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': shouldBlur ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
            },
        });
    };

    try {
        return await tryLoadImage(splitUrl);
    } catch (error) {
        const modifiedUrl = splitUrl.replace(/\.jpg.*$/, '');
        try {
            return await tryLoadImage(modifiedUrl);
        } catch (secondError) {
            throw secondError;
        }
    }
};

const getFileFromPath = async (path: string): Promise<any> => {
  if (!db) return null;

  const pathParts = path.split('/');
  let file = null;

  if (path.includes('_thumb_')) {
    const uniqueIdMatch = path.match(/([^\/]+)_thumb_\d+\.jpg/);
    if (uniqueIdMatch) {
      const uniqueId = uniqueIdMatch[1];
      const { data } = await db
        .from('files')
        .select('*')
        .eq('unique_id', uniqueId)
        .maybeSingle();
      file = data;
    }
  } else if (pathParts.length >= 2) {
    const uniqueId = pathParts[pathParts.length - 2];
    const { data } = await db
      .from('files')
      .select('*')
      .eq('unique_id', uniqueId)
      .maybeSingle();
    file = data;
  } else if (path.includes('thumbnail_')) {
    const uniqueIdMatch = path.match(/\/([^\/]+)\/thumbnail_/);
    if (uniqueIdMatch) {
      const uniqueId = uniqueIdMatch[1];
      const { data } = await db
        .from('files')
        .select('*')
        .eq('unique_id', uniqueId)
        .maybeSingle();
      file = data;
    }
  } else {
    const { data } = await db
      .from('files')
      .select('*')
      .eq('endpoint', path)
      .maybeSingle();
    file = data;
  }

  return file;
};

export const loader = async ({ request }: { request: Request }) => {
    try {
        const url = new URL(request.url);
        const qualityParam = url.searchParams.get('quality');
        let splitUrl = request.url.split('/api/load/image/')[1].split('?')[0];
        if(splitUrl.includes(`%`)){
            splitUrl = decodeURIComponent(splitUrl)
        }

        const file = await getFileFromPath(splitUrl);
        
        if (file) {
          const hasAccess = await canAccessFile(request, file);
          if (!hasAccess && file.is_adult) {
            return await loadImageWithRetry(splitUrl, qualityParam, true);
          }
        }

        return await loadImageWithRetry(splitUrl, qualityParam, false);
    } catch (error) {
        console.error('Error loading image:', error)
        return new Response(null, { status: 500 });
    }
};
