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
    sleep?: number;
    retries?: number;
}

const requestQueue: RequestQueueItem[] = [];

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

        const anyHeaders = (resp.headers as any);
        const setCookies: string[] | undefined = typeof anyHeaders.getSetCookie === 'function'
            ? anyHeaders.getSetCookie()
            : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie') as string] : undefined);

        if (!setCookies || setCookies.length === 0) return undefined;

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
    for (const pair of cookieHeader.split(';')) {
        const trimmed = pair.trim();
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const name = trimmed.slice(0, eq);
        const value = trimmed.slice(eq + 1);
        lines.push(`${domain}\tTRUE\t/\tFALSE\t0\t${name}\t${value}`);
    }
    await writeFile(outPath, lines.join('\n') + '\n', 'utf8');
}

async function exportCookiesFromBrowser(
    browser: string,
    targetUrl: string,
    outputPath: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const browserName = browser === 'chromium-browser' ? 'chromium' : browser;
        const args = [
            '--cookies-from-browser', browserName,
            '--cookies', outputPath,
            '--no-warnings',
            '--no-check-certificate',
            '--no-download',
            targetUrl
        ];

        const ytDlp = spawn('yt-dlp', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        let stdout = '';

        ytDlp.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        ytDlp.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        ytDlp.on('close', (code) => {
            if (code !== 0 && !existsSync(outputPath)) {
                reject(new Error(`Failed to export cookies: ${stderr || stdout || 'Unknown error'}`));
                return;
            }
            if (existsSync(outputPath)) {
                resolve();
            } else {
                reject(new Error(`Cookies file not created: ${stderr || stdout || 'Unknown error'}`));
            }
        });

        ytDlp.on('error', (error) => {
            reject(new Error(`Failed to start yt-dlp: ${error.message}`));
        });
    });
}

function isRateLimitError(error: string): boolean {
    const lowerError = error.toLowerCase();
    return lowerError.includes('rate-limit') || 
           lowerError.includes('rate limited') ||
           lowerError.includes('rate limit') ||
           lowerError.includes('rate-limited') ||
           lowerError.includes('session has been rate-limited') ||
           lowerError.includes('429') ||
           lowerError.includes('too many requests') ||
           lowerError.includes('exceeding the rate limit');
}

async function downloadVideo(
    url: string,
    options: DownloadOptions = {}
): Promise<{ filePath: string; filename: string }> {
    const { format = 'mp4', quality = 'highest', cookie, cookiesFilePath, sleep = 1, retries = 3 } = options;
    const downloadId = randomUUID();
    const tempDir = join(tmpdir(), 'social-downloads');
    
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
        '--extractor-retries', String(retries),
        '--restrict-filenames',
        '--windows-filenames',
        '--format', formatSelector,
        '--output', outputTemplate,
    ];

    if (platform === 'youtube' && sleep > 0) {
        args.push('--sleep-requests', String(sleep));
        args.push('--sleep-interval', String(sleep));
        args.push('--max-sleep-interval', String(sleep * 2));
    }

    if (platform === 'instagram') {
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
        args.push('--extractor-args', 'instagram:web_display_retry=1');
    } else {
        args.push('--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        args.push('--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        args.push('--add-header', 'Accept-Language:en-us,en;q=0.5');
        args.push('--add-header', 'Sec-Fetch-Mode:navigate');
    }

    if (cookiesFilePath) {
        args.push('--cookies', cookiesFilePath);
    }

    if (!cookiesFilePath && cookie) {
        args.push('--add-header', `Cookie:${cookie}`);
    }

    if (format === 'mp3') {
        args.push('--extract-audio', '--audio-format', 'mp3');
        args.push('--audio-quality', quality === 'highest' ? '320K' : '128K');
    } else {
        args.push('--merge-output-format', 'mp4');
    }

    args.push(url);

    return new Promise(async (resolve, reject) => {
        let attempt = 0;
        const maxAttempts = retries + 1;
        
        while (attempt < maxAttempts) {
            attempt++;
            
            if (attempt > 1) {
                const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 2), 60000);
                console.log(`Retry attempt ${attempt}/${maxAttempts} after ${backoffDelay}ms delay`);
                await new Promise(res => setTimeout(res, backoffDelay));
            }

            const result = await new Promise<{ success: boolean; error?: string; filePath?: string; filename?: string }>((resolveAttempt) => {
                const ytDlp = spawn('yt-dlp', args, {
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                let stderr = '';
                let stdout = '';

                ytDlp.stdout?.on('data', (data) => {
                    stdout += data.toString();
                });

                ytDlp.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });

                ytDlp.on('close', async (code) => {
                    if (code !== 0) {
                        const errorText = stderr || stdout || 'Unknown error';
                        resolveAttempt({ success: false, error: errorText });
                        return;
                    }

                    await new Promise((res) => setTimeout(res, 150));

                    try {
                        const files = await readdir(tempDir);
                        let downloadedFile = files.find(f => f.startsWith(downloadId));

                        if (!downloadedFile) {
                            downloadedFile = files.find(f => f.includes(downloadId));
                        }

                        if (!downloadedFile) {
                            resolveAttempt({ success: false, error: 'File not found after download' });
                            return;
                        }

                        const filePath = join(tempDir, downloadedFile);
                        const filename = downloadedFile.replace(`${downloadId}_`, '');
                        resolveAttempt({ success: true, filePath, filename });
                    } catch (error) {
                        resolveAttempt({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
                    }
                });

                ytDlp.on('error', (error) => {
                    resolveAttempt({ success: false, error: `Failed to start yt-dlp: ${error.message}` });
                });
            });

            if (result.success && result.filePath && result.filename) {
                resolve({ filePath: result.filePath, filename: result.filename });
                return;
            }

            if (result.error && isRateLimitError(result.error)) {
                if (attempt < maxAttempts) {
                    console.log(`Rate limit detected, will retry. Attempt ${attempt}/${maxAttempts}`);
                    continue;
                } else {
                    try {
                        const files = await readdir(tempDir);
                        for (const file of files) {
                            if (file.startsWith(downloadId)) {
                                await rm(join(tempDir, file), { force: true });
                            }
                        }
                    } catch (e) {
                    }
                    reject(new Error(`yt-dlp failed after ${maxAttempts} attempts (rate limited): \n --- ${result.error}`));
                    return;
                }
            }

            if (attempt >= maxAttempts || !isRateLimitError(result.error || '')) {
                try {
                    const files = await readdir(tempDir);
                    for (const file of files) {
                        if (file.startsWith(downloadId)) {
                            await rm(join(tempDir, file), { force: true });
                        }
                    }
                } catch (e) {
                }
                reject(new Error(`yt-dlp failed: \n --- ${result.error || 'Unknown error'}`));
                return;
            }
        }
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
        
        let socialUrl = decodeURIComponent(url.pathname.split(`/socials/`)[1] || '');
        
        if (socialUrl && !socialUrl.includes('?') && url.search) {
            const testUrl = socialUrl + url.search;
            try {
                const testUrlObj = new URL(testUrl);
                const searchParams = url.searchParams;
                const hasApiParams = searchParams.has('format') || searchParams.has('quality') || 
                                   searchParams.has('cookie') || searchParams.has('cookies_url') ||
                                   searchParams.has('refresh_cookies');
                
                if (!hasApiParams) {
                    socialUrl = testUrl;
                }
            } catch {
            }
        }
        
        if (!socialUrl) {
            return new Response(JSON.stringify({ error: 'Social URL is required' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            new URL(socialUrl);
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid URL format' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const platform = detectPlatform(socialUrl);
        if (platform === 'unknown') {
            return new Response(JSON.stringify({ error: 'Unsupported platform. Supported: YouTube, Facebook, Instagram, TikTok' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const searchParams = url.searchParams;
        const format = (searchParams.get('format') || 'mp4') as 'mp4' | 'mp3';
        const quality = (searchParams.get('quality') || 'highest') as DownloadOptions['quality'];
        let cookie = searchParams.get('cookie') || undefined;
        const cookiesUrl = searchParams.get('cookies_url') || undefined;
        const cookiesInline = searchParams.get('cookies_inline') || undefined;
        const refreshCookies = searchParams.get('refresh_cookies') === '1';
        const sleep = searchParams.get('sleep') ? parseInt(searchParams.get('sleep')!, 10) : (platform === 'youtube' ? 2 : 1);
        const retries = searchParams.get('retries') ? parseInt(searchParams.get('retries')!, 10) : 3;

        const hostname = new URL(socialUrl).hostname;
        const cookiesDir = join(process.cwd(), 'app', 'routes', 'Api', 'Socials');
        if (!existsSync(cookiesDir)) {
            await mkdir(cookiesDir, { recursive: true });
        }
        const persistentCookiesPath = join(cookiesDir, `${hostname}.cookies.txt`);

        let cookiesFilePath: string | undefined;
        
        const legacyCookiesPath = join(process.cwd(), 'app', 'routes', 'Socials', `${hostname}.cookies.txt`);
        if (!cookiesFilePath && existsSync(legacyCookiesPath) && !refreshCookies) {
            cookiesFilePath = legacyCookiesPath;
        }
        
        const exportFromBrowser = searchParams.get('export_cookies_from_browser');
        if (exportFromBrowser) {
            try {
                await exportCookiesFromBrowser(exportFromBrowser, socialUrl, persistentCookiesPath);
                cookiesFilePath = persistentCookiesPath;
                console.log(`Successfully exported cookies from ${exportFromBrowser} browser`);
            } catch (error) {
                console.error('Failed to export cookies from browser:', error);
            }
        }
        
        if (!cookiesFilePath && !exportFromBrowser) {
            const browsersToTry = ['chromium-browser', 'chromium', 'chrome', 'firefox', 'edge'];
            for (const browser of browsersToTry) {
                try {
                    await exportCookiesFromBrowser(browser, socialUrl, persistentCookiesPath);
                    if (existsSync(persistentCookiesPath)) {
                        const cookieContent = await readFile(persistentCookiesPath, 'utf8');
                        if (cookieContent.trim().length > 0 && cookieContent.includes('\t')) {
                            cookiesFilePath = persistentCookiesPath;
                            console.log(`Auto-detected and using cookies from ${browser} browser`);
                            break;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
        }
        
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

        if (!cookiesFilePath && cookiesInline) {
            await writeNetscapeCookiesFileFromHeader(cookiesInline, socialUrl, persistentCookiesPath);
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
        
        if (!cookiesFilePath && (platform === 'youtube' || platform === 'instagram' || platform === 'facebook')) {
            const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
            return new Response(JSON.stringify({ 
                error: `${platformName} requires cookies to bypass bot detection and rate limits. Please provide cookies using one of these methods:\n` +
                       '1. Auto-detect: Install a browser (chrome/chromium/firefox) on your server and log in to the platform. The code will auto-detect cookies.\n' +
                       '2. Manual export: ?export_cookies_from_browser=chrome (or chromium, firefox, edge, safari)\n' +
                       '3. Upload cookies file: ?cookies_url=<url-to-cookies-file>\n' +
                       '4. Inline cookies: ?cookies_inline=<cookie-header-string>\n' +
                       '5. Manually create cookies file: Create <hostname>.cookies.txt in the cookies directory\n' +
                       '\nFor EC2/server setup:\n' +
                       '- Install browser: sudo apt install -y chromium-browser (or firefox-esr)\n' +
                       '- Log in to the platform in the browser to generate cookies\n' +
                       '- The code will automatically use those cookies\n' +
                       '\nTo export cookies manually:\n' +
                       '- Use browser extension like "Get cookies.txt LOCALLY" or "Cookie-Editor"\n' +
                       '- Or use yt-dlp: yt-dlp --cookies-from-browser chromium --cookies cookies.txt <platform-url>'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { filePath, filename } = await downloadVideo(socialUrl, {
            format,
            quality,
            cookie,
            cookiesFilePath,
            sleep,
            retries,
        });

        const fileBuffer = await readFile(filePath);
        
        const contentType = format === 'mp3' 
            ? 'audio/mpeg' 
            : 'video/mp4';

        try {
            await rm(filePath, { force: true });
        } catch (e) {
        }
        

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