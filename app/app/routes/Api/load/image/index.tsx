import { createCanvas, loadImage } from 'canvas';

const loadImageWithRetry = async (splitUrl: string, qualityParam: string | null): Promise<Response> => {
    const tryLoadImage = async (urlPath: string): Promise<Response> => {
        const videoUrl = `https://github.com/${process.env.GITHUB_OWNER}/Memories/raw/main/${urlPath}`;
        const response = await fetch(videoUrl);
    
        if (!response.ok) throw new Error('Fetch failed');
    
        if (!qualityParam) {
            const body = new Uint8Array(await response.arrayBuffer());
            return new Response(body, {
                status: 200,
                headers: {
                    'Content-Type': `image/png`,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            });
        }

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
        
        const processedBuffer = canvas.toBuffer('image/png');

        return new Response(new Uint8Array(processedBuffer), {
            status: 200,
            headers: {
                'Content-Type': `image/png`,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=31536000, immutable',
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

export const loader = async ({ request }: { request: Request }) => {
    try {
        const url = new URL(request.url);
        const qualityParam = url.searchParams.get('quality');
        let splitUrl = request.url.split('/api/load/image/')[1].split('?')[0];
        if(splitUrl.includes(`%`)){
            splitUrl = decodeURIComponent(splitUrl)
        }
        return await loadImageWithRetry(splitUrl, qualityParam);
    } catch (error) {
        console.error('Error loading image:', error)
        return new Response(null, { status: 500 });
    }
};
  