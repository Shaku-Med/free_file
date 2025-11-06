import { spawn } from 'child_process';
import { readFile, mkdir, rm, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

interface RequestQueueItem {
    social_url: string;
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface DownloadOptions {
    format?: 'mp4' | 'mp3';
    quality?: 'highest' | '4k' | '1080p' | '720p' | '480p' | '360p' | 'lowest';
    cookie?: string;
    cookiesFilePath?: string;
}

const requestQueue: RequestQueueItem[] = [];

// Detect platform from URL
function detectPlatform(url: string): 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'unknown' {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
        return 'youtube';
    }
    if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com') || lowerUrl.includes('fb.watch')) {
        return 'facebook';
    }
    if (lowerUrl.includes('instagram.com') || lowerUrl.includes('instagr.am')) {
        return 'instagram';
    }
    if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('vm.tiktok.com')) {
        return 'tiktok';
    }
    return 'unknown';
}

// Get format selector for quality
function getFormatSelector(quality: string, format: string): string {
    if (format === 'mp3') {
        return 'bestaudio/best';
    }

    switch (quality) {
        case 'highest':
            return 'bestvideo[height<=4320]+bestaudio/best[height<=4320]/best';
        case '4k':
            return 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best';
        case '1080p':
            return 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
        case '720p':
            return 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
        case '480p':
            return 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
        case '360p':
            return 'bestvideo[height<=360]+bestaudio/best[height<=360]/best';
        case 'lowest':
            return 'worst[height>=360]';
        default:
            return 'bestvideo+bestaudio/best';
    }
}

// Attempt to collect anonymous cookies by making a server-side request
async function collectAnonymousCookies(targetUrl: string): Promise<string | undefined> {
    try {
        const resp = await fetch(targetUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        } as RequestInit);

        // undici (Node fetch) supports getSetCookie(); fall back to single header
        const anyHeaders = (resp.headers as any);
        const setCookies: string[] | undefined = typeof anyHeaders.getSetCookie === 'function'
            ? anyHeaders.getSetCookie()
            : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie') as string] : undefined);

        if (!setCookies || setCookies.length === 0) return undefined;

        // Convert Set-Cookie[] to a Cookie header string: name=value; name2=value2
        const cookiePairs: string[] = [];
        for (const sc of setCookies) {
            const semi = sc.indexOf(';');
            const pair = semi >= 0 ? sc.slice(0, semi) : sc;
            if (pair && pair.includes('=')) cookiePairs.push(pair);
        }
        if (cookiePairs.length === 0) return undefined;
        return cookiePairs.join('; ');
    } catch {
        return undefined;
    }
}

function getCookieDomainForUrl(rawUrl: string): string {
    try {
        const u = new URL(rawUrl);
        const host = u.hostname;
        return host.startsWith('.') ? host : `.${host}`;
    } catch {
        return '.instagram.com';
    }
}

async function writeNetscapeCookiesFileFromHeader(
    cookieHeader: string,
    targetUrl: string,
    outPath: string
): Promise<void> {
    const domain = getCookieDomainForUrl(targetUrl);
    const lines: string[] = [
        '# Netscape HTTP Cookie File',
    ];
    // cookieHeader: "a=1; b=2; c=3"
    for (const pair of cookieHeader.split(';')) {
        const trimmed = pair.trim();
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const name = trimmed.slice(0, eq);
        const value = trimmed.slice(eq + 1);
        // domain\tinclude_subdomains\tpath\tsecure\texpiry\tname\tvalue
        lines.push(`${domain}\tTRUE\t/\tFALSE\t0\t${name}\t${value}`);
    }
    await writeFile(outPath, lines.join('\n') + '\n', 'utf8');
}

// Download video using yt-dlp
async function downloadVideo(
    url: string,
    options: DownloadOptions = {}
): Promise<{ filePath: string; filename: string }> {
    const { format = 'mp4', quality = 'highest', cookie, cookiesFilePath } = options;
    const downloadId = randomUUID();
    const tempDir = join(tmpdir(), 'social-downloads');
    
    // Ensure temp directory exists
    if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
    }

    const outputTemplate = join(tempDir, `${downloadId}_%(id)s.%(ext)s`);
    const formatSelector = getFormatSelector(quality, format);
    const platform = detectPlatform(url);

    const args: string[] = [
        '--no-warnings',
        '--no-check-certificate',
        '--no-color',
        '--extractor-retries', '3',
        '--restrict-filenames',
        '--windows-filenames',
        '--format', formatSelector,
        '--output', outputTemplate,
    ];

    // Instagram-specific handling to bypass login requirement
    if (platform === 'instagram') {
        // Use mobile user agent and headers for Instagram (more lenient)
        args.push('--add-header', 'User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
        args.push('--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        args.push('--add-header', 'Accept-Language:en-US,en;q=0.9');
        args.push('--add-header', 'Accept-Encoding:gzip, deflate, br');
        args.push('--add-header', 'X-Requested-With:XMLHttpRequest');
        args.push('--add-header', 'X-IG-App-ID:936619743392459');
        args.push('--add-header', 'X-IG-WWW-Claim:0');
        args.push('--add-header', 'Origin:https://www.instagram.com');
        args.push('--add-header', 'Referer:https://www.instagram.com/');
        args.push('--add-header', 'Sec-Fetch-Dest:document');
        args.push('--add-header', 'Sec-Fetch-Mode:navigate');
        args.push('--add-header', 'Sec-Fetch-Site:none');
        args.push('--add-header', 'Sec-Fetch-User:?1');
        args.push('--add-header', 'Upgrade-Insecure-Requests:1');
        // Avoid spoofing IP via X-Forwarded-For; it does not help here
        
        // Try to use mobile API endpoint
        args.push('--extractor-args', 'instagram:web_display_retry=1');
    } else {
        // Standard headers for other platforms
        args.push('--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        args.push('--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        args.push('--add-header', 'Accept-Language:en-us,en;q=0.5');
        args.push('--add-header', 'Sec-Fetch-Mode:navigate');
        // Avoid spoofing IP via X-Forwarded-For; it does not help here
    }

    // Use cookies file if provided
    if (cookiesFilePath) {
        args.push('--cookies', cookiesFilePath);
    }

    // If we have a cookie string (provided or collected), pass it directly as a header
    if (!cookiesFilePath && cookie) {
        args.push('--add-header', `Cookie:${cookie}`);
    }

    // MP3 extraction
    if (format === 'mp3') {
        args.push('--extract-audio', '--audio-format', 'mp3');
        args.push('--audio-quality', quality === 'highest' ? '320K' : '128K');
    } else {
        args.push('--merge-output-format', 'mp4');
        // Removed --prefer-ffmpeg as it's deprecated
    }

    // Add URL at the end
    args.push(url);

    return new Promise((resolve, reject) => {
        const ytDlp = spawn('yt-dlp', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';

        ytDlp.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        ytDlp.on('close', async (code) => {
            if (code !== 0) {
                // Cleanup on error
                try {
                    const files = await readdir(tempDir);
                    for (const file of files) {
                        if (file.startsWith(downloadId)) {
                            await rm(join(tempDir, file), { force: true });
                        }
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }
                reject(new Error(`yt-dlp failed: \n --- ${stderr || 'Unknown error'}`));
                return;
            }

            // Find the downloaded file
            try {
                const files = await readdir(tempDir);
                const downloadedFile = files.find(f => f.startsWith(downloadId));
                
                if (!downloadedFile) {
                    reject(new Error('Download completed but file not found'));
                    return;
                }

                const filePath = join(tempDir, downloadedFile);
                const filename = downloadedFile.replace(`${downloadId}_`, '');

                resolve({ filePath, filename });
            } catch (error) {
                reject(error);
            }
        });

        ytDlp.on('error', (error) => {
            reject(new Error(`Failed to start yt-dlp: \n --- ${error.message}`));
        });
    });
}

export const AllActions = async () => {
    try {
        return 'buffers';
    } catch (error) {
        console.error('Error fetching socials:', error);
        return null;
    }
};

export const loader = async ({ request }: { request: Request }) => {
    try {
        const url = new URL(request.url);
        const socialUrl = decodeURIComponent(url.pathname.split(`/socials/`)[1]);
        
        if (!socialUrl) {
            return new Response(JSON.stringify({ error: 'Social URL is required' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate URL format
        try {
            new URL(socialUrl);
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid URL format' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Detect platform
        const platform = detectPlatform(socialUrl);
        if (platform === 'unknown') {
            return new Response(JSON.stringify({ error: 'Unsupported platform. Supported: YouTube, Facebook, Instagram, TikTok' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Parse query parameters
        const searchParams = url.searchParams;
        const format = (searchParams.get('format') || 'mp4') as 'mp4' | 'mp3';
        const quality = (searchParams.get('quality') || 'highest') as DownloadOptions['quality'];
        let cookie = searchParams.get('cookie') || undefined;
        const cookiesUrl = searchParams.get('cookies_url') || undefined;
        const refreshCookies = searchParams.get('refresh_cookies') === '1';

        const hostname = new URL(socialUrl).hostname;
        const cookiesDir = join(process.cwd(), 'app', 'routes', 'Socials');
        if (!existsSync(cookiesDir)) {
            await mkdir(cookiesDir, { recursive: true });
        }
        const persistentCookiesPath = join(cookiesDir, `${hostname}.cookies.txt`);

        let cookiesFilePath: string | undefined;
        if (cookiesUrl) {
            const resp = await fetch(cookiesUrl);
            if (!resp.ok) {
                return new Response(JSON.stringify({ error: `Failed to fetch cookies file: ${resp.status} ${resp.statusText}` }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            const text = await resp.text();
            await writeFile(persistentCookiesPath, text, 'utf8');
            cookiesFilePath = persistentCookiesPath;
        }

        if (!cookiesFilePath) {
            if (existsSync(persistentCookiesPath) && !refreshCookies) {
                cookiesFilePath = persistentCookiesPath;
            } else {
                if (!cookie) {
                    cookie = await collectAnonymousCookies(socialUrl);
                }
                if (cookie) {
                    await writeNetscapeCookiesFileFromHeader(cookie, socialUrl, persistentCookiesPath);
                    cookiesFilePath = persistentCookiesPath;
                }
            }
        }

        // Download the video
        const { filePath, filename } = await downloadVideo(socialUrl, {
            format,
            quality,
            cookie,
            cookiesFilePath,
        });

        // Read the file
        const fileBuffer = await readFile(filePath);
        
        // Determine content type
        const contentType = format === 'mp3' 
            ? 'audio/mpeg' 
            : 'video/mp4';

        // Clean up the file after reading
        try {
            await rm(filePath, { force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
        

        // Return the file
        return new Response(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });

    } catch (error) {
        console.error('Error downloading social media content:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return new Response(JSON.stringify({ error: errorMessage }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};