import { config } from "~/lib/config";

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const path = url.pathname.split('/api/load/profilepic/')[1];
    
    if (!path) {
      return new Response('Profile picture path not provided', { status: 400 });
    }

    if (!config.github.token || !config.github.owner) {
      return new Response('GitHub configuration missing', { status: 500 });
    }

    const githubUrl = `https://raw.githubusercontent.com/${config.github.owner}/Memories/main/${path}`;
    
    const response = await fetch(githubUrl);
    
    if (!response.ok) {
      return new Response('Profile picture not found', { status: 404 });
    }

    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error loading profile picture:', error);
    return new Response('Failed to load profile picture', { status: 500 });
  }
};
