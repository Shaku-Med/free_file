export const loader = async ({ request }: { request: Request }) => {
    try {
      const splitUrl = request.url.split('/api/load/video/')[1];
      const videoUrl = `https://github.com/lagging-stl/memories/raw/main/${splitUrl}`;
      const response = await fetch(videoUrl);
  
      if (!response.ok) throw new Error('Fetch failed');
  
      const ext = splitUrl.split('.').pop();
      const isText = ext === 'm3u8';
      const body = isText ? await response.text() : new Uint8Array(await response.arrayBuffer());
      const contentType =
        ext === 'm3u8'
          ? 'application/vnd.apple.mpegurl'
          : ext === 'ts'
          ? 'video/mp2t'
          : 'application/octet-stream';
  
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (error) {
      console.error('Error loading video:', error);
      return new Response(null, { status: 500 });
    }
  };
  