import { config } from "~/lib/config";

function normalizeProfilePicPath(path: string): string | null {
  try {
    const decoded = decodeURIComponent(path).replace(/\\/g, '/');
    if (decoded.includes('..') || decoded.startsWith('/') || /^\s/.test(decoded)) return null;
    const segments = decoded.split('/').filter(Boolean);
    if (segments.length < 1 || segments.some(s => s.startsWith('.') || s === '..')) return null;
    return segments.join('/');
  } catch {
    return null;
  }
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const rawPath = url.pathname.split('/api/load/profilepic/')[1];
    const path = rawPath ? normalizeProfilePicPath(rawPath) : null;
    if (!path) {
      return new Response('Invalid path', { status: 400 });
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
