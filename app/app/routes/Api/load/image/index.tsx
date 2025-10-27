import { createRateLimit, rateLimitConfigs } from '../../../../lib/middleware/rateLimiter';

const imageLoadRateLimit = createRateLimit(rateLimitConfigs.api);

export const loader = async ({ request }: { request: Request }) => {
    return imageLoadRateLimit(request, async () => {
        try {
            const splitUrl = request.url.split('/api/load/image/')[1];
            const videoUrl = `https://github.com/${process.env.GITHUB_OWNER}/Memories/raw/main/${splitUrl}`;
            const response = await fetch(videoUrl);
        
            if (!response.ok) throw new Error('Fetch failed');
        
            const body = new Uint8Array(await response.arrayBuffer());

            return new Response(body, {
                status: 200,
                headers: {
                'Content-Type': `image/png`,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=31536000, immutable',
                },
            });
        } catch (error) {
            return new Response(null, { status: 500 });
        }
    });
};
  