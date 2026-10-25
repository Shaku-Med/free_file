import { spawn } from 'child_process';
import { readFile, mkdir, rm, readdir, writeFile, stat } from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { safeFetch } from '~/lib/Security/ssrfGuard.server';
import { rateLimiter } from '~/routes/Auth/fun/rateLimit.server';

// Biggest file one import may pull onto this server's disk.
const MAX_DOWNLOAD = '2G';
const FORMATS = ['mp4', 'mp3'] as const;
const QUALITIES = ['highest', '4k', '1080p', '720p', '480p', '360p', 'lowest'] as const;

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

function convertWindowsPathToWsl(windowsPath: string): string {
    return windowsPath
        .replace(/^([A-Z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
        .replace(/\\/g, '/');
}

function getYtDlpCommand(): { command: string; args: string[]; useWsl: boolean } {
    const isWindows = platform() === 'win32';
    
    if (isWindows) {
        return {
            command: 'wsl',
            args: ['-e', 'yt-dlp'],
            useWsl: true
        };
    }
    
    return {
        command: 'yt-dlp',
        args: [],
        useWsl: false
    };
}

const PLATFORM_HOSTS: ReadonlyArray<{
    platform: 'youtube' | 'facebook' | 'instagram' | 'tiktok';
    hosts: readonly string[];
}> = [
    { platform: 'youtube', hosts: ['youtube.com', 'youtu.be'] },
    { platform: 'facebook', hosts: ['facebook.com', 'fb.com', 'fb.watch'] },
    { platform: 'instagram', hosts: ['instagram.com', 'instagr.am'] },
    { platform: 'tiktok', hosts: ['tiktok.com'] },
];

/**
 * Match on the HOSTNAME, and only as a whole label.
 *
 * This used to test `url.includes('youtube.com')` against the entire string, so
 * http://169.254.169.254/youtube.com sailed through the platform gate and on
 * into a server side fetch. Anchoring to the host, and requiring either an
 * exact match or a dotted suffix, means evil-youtube.com and
 * youtube.com.attacker.net are rejected too.
 */
function detectPlatform(url: string): 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'unknown' {
    let host: string;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'unknown';
        host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    } catch {
        return 'unknown';
    }
    for (const { platform, hosts } of PLATFORM_HOSTS) {
        for (const allowed of hosts) {
            if (host === allowed || host.endsWith(`.${allowed}`)) return platform;
        }
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
        const resp = await safeFetch(targetUrl, {
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
        let host = u.hostname;
        
        if (host.includes('youtube.com')) {
            return '.youtube.com';
        }
        if (host.includes('youtu.be')) {
            return '.youtube.com';
        }
        
        if (host.startsWith('www.')) {
            host = host.replace(/^www\./, '');
        }
        
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
        const { command, args: baseArgs, useWsl } = getYtDlpCommand();
        const ytDlpArgs = [
            '--cookies-from-browser', browser,
            '--cookies', useWsl ? convertWindowsPathToWsl(outputPath) : outputPath,
            '--no-warnings',
            '--no-download',
            targetUrl
        ];
        
        const allArgs = useWsl ? [...baseArgs, ...ytDlpArgs] : ytDlpArgs;

        const ytDlp = spawn(command, allArgs, {
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
                const errorMsg = stderr || stdout || 'Unknown error';
                if (errorMsg.includes('could not find') || errorMsg.includes('cookies database')) {
                    reject(new Error(`Browser ${browser} not found or no cookies available`));
                } else {
                    reject(new Error(`Failed to export cookies: ${errorMsg}`));
                }
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

function getBaseUrlFromHostname(hostname: string): string {
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        return 'https://www.youtube.com';
    }
    if (hostname.includes('facebook.com') || hostname.includes('fb.com') || hostname.includes('fb.watch')) {
        return 'https://www.facebook.com';
    }
    if (hostname.includes('instagram.com') || hostname.includes('instagr.am')) {
        return 'https://www.instagram.com';
    }
    if (hostname.includes('tiktok.com') || hostname.includes('vm.tiktok.com')) {
        return 'https://www.tiktok.com';
    }
    return `https://${hostname}`;
}

async function refreshCookiesWithYtDlp(
    cookiesFilePath: string,
    baseUrl: string
): Promise<void> {
    return new Promise((resolve) => {
        const { command, args: baseArgs, useWsl } = getYtDlpCommand();
        const cookiesPath = useWsl ? convertWindowsPathToWsl(cookiesFilePath) : cookiesFilePath;
        
        const ytDlpArgs = [
            '--cookies', cookiesPath,
            '--no-download',
            '--no-warnings',
            baseUrl
        ];
        
        const allArgs = useWsl ? [...baseArgs, ...ytDlpArgs] : ytDlpArgs;

        const ytDlp = spawn(command, allArgs, {
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
            if (code !== 0) {
                const errorMsg = stderr || stdout || 'Unknown error';
                console.warn(`Failed to refresh cookies: ${errorMsg}`);
                resolve();
                return;
            }
            resolve();
        });

        ytDlp.on('error', (error) => {
            console.warn(`Failed to start yt-dlp for cookie refresh: ${error.message}`);
            resolve();
        });
    });
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

    const { useWsl } = getYtDlpCommand();
    const outputTemplate = useWsl ? convertWindowsPathToWsl(join(tempDir, `${downloadId}_%(id)s.%(ext)s`)) : join(tempDir, `${downloadId}_%(id)s.%(ext)s`);
    const formatSelector = getFormatSelector(quality, format);
    const platform = detectPlatform(url);

    let tempCookiesFilePath: string | undefined;
    let finalCookiesFilePath = cookiesFilePath;

    if (!cookiesFilePath && cookie && platform === 'youtube') {
        const tempCookiesFile = join(tempDir, `${downloadId}_cookies.txt`);
        await writeNetscapeCookiesFileFromHeader(cookie, url, tempCookiesFile);
        tempCookiesFilePath = tempCookiesFile;
        finalCookiesFilePath = tempCookiesFile;
    }

    const args: string[] = [
        '--no-warnings',
        '--no-color',
        '--max-filesize', MAX_DOWNLOAD,
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

    if (finalCookiesFilePath) {
        const cookiesPath = useWsl ? convertWindowsPathToWsl(finalCookiesFilePath) : finalCookiesFilePath;
        args.push('--cookies', cookiesPath);
    }

    if (!finalCookiesFilePath && cookie && platform !== 'youtube') {
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
                const { command, args: baseArgs, useWsl } = getYtDlpCommand();
                const allArgs = useWsl ? [...baseArgs, ...args] : args;
                
                const ytDlp = spawn(command, allArgs, {
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
                if (tempCookiesFilePath && existsSync(tempCookiesFilePath)) {
                    try {
                        await rm(tempCookiesFilePath, { force: true });
                    } catch (e) {
                    }
                }
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
        // Auth check  only authenticated users can use social downloads
        const { isAuthenticated } = await import("~/lib/Security/Password");
        const user = await isAuthenticated(request, ["id"]);
        if (!user?.id) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Every import runs yt-dlp and fills this server's disk with a whole video.
        const limit = await rateLimiter.checkLimit(String(user.id), 'socials-download', 10, 10 * 60_000, 10 * 60_000);
        if (!limit.allowed) {
            return new Response(JSON.stringify({ error: limit.error ?? 'Too many requests' }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' },
            });
        }

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
        const format = FORMATS.find((f) => f === searchParams.get('format')) ?? 'mp4';
        const quality = QUALITIES.find((q) => q === searchParams.get('quality')) ?? 'highest';
        // The cookie files here are shared by everyone who imports, so they only
        // ever come from the server itself, never from a request.
        let cookie: string | undefined;
        const sleep = platform === 'youtube' ? 2 : 1;
        const retries = 3;

        const hostname = new URL(socialUrl).hostname;
        const cookiesFolder = join(process.cwd(), 'cookies');
        if (!existsSync(cookiesFolder)) {
            await mkdir(cookiesFolder, { recursive: true });
        }
        const cookiesFolderPath = join(cookiesFolder, `${hostname}.cookies.txt`);
        const cookiesDir = join(process.cwd(), 'app', 'routes', 'Api', 'Socials');
        if (!existsSync(cookiesDir)) {
            await mkdir(cookiesDir, { recursive: true });
        }
        const persistentCookiesPath = join(cookiesDir, `${hostname}.cookies.txt`);

        let cookiesFilePath: string | undefined;
        
        const hostnameVariations = [hostname];
        if (hostname.startsWith('www.')) {
            hostnameVariations.push(hostname.replace(/^www\./, ''));
        } else {
            hostnameVariations.push(`www.${hostname}`);
        }
        
        for (const hostnameVar of hostnameVariations) {
            const cookiesPath = join(cookiesFolder, `${hostnameVar}.cookies.txt`);
            if (!cookiesFilePath && existsSync(cookiesPath)) {
                cookiesFilePath = cookiesPath;
                break;
            }
        }
        
        const legacyCookiesPath = join(process.cwd(), 'app', 'routes', 'Socials', `${hostname}.cookies.txt`);
        if (!cookiesFilePath && existsSync(legacyCookiesPath)) {
            cookiesFilePath = legacyCookiesPath;
        }
        
        if (!cookiesFilePath) {
            const browsersToTry = ['chromium', 'chrome', 'firefox', 'edge'];
            for (const browser of browsersToTry) {
                try {
                    await exportCookiesFromBrowser(browser, socialUrl, cookiesFolderPath);
                    if (existsSync(cookiesFolderPath)) {
                        const cookieContent = await readFile(cookiesFolderPath, 'utf8');
                        if (cookieContent.trim().length > 0 && cookieContent.includes('\t')) {
                            cookiesFilePath = cookiesFolderPath;
                            console.log(`Auto-detected and using cookies from ${browser} browser`);
                            break;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
        }
        
        if (!cookiesFilePath) {
            for (const hostnameVar of hostnameVariations) {
                const cookiesPath = join(cookiesFolder, `${hostnameVar}.cookies.txt`);
                if (existsSync(cookiesPath)) {
                    cookiesFilePath = cookiesPath;
                    break;
                }
            }
            if (!cookiesFilePath && existsSync(persistentCookiesPath)) {
                cookiesFilePath = persistentCookiesPath;
            }
            if (!cookiesFilePath) {
                cookie = await collectAnonymousCookies(socialUrl);
                if (cookie) {
                    await writeNetscapeCookiesFileFromHeader(cookie, socialUrl, cookiesFolderPath);
                    cookiesFilePath = cookiesFolderPath;
                }
            }
        }
        
        if (!cookiesFilePath && (platform === 'youtube' || platform === 'instagram' || platform === 'facebook')) {
            const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
            return new Response(JSON.stringify({ 
                error: `${platformName} needs cookies on the server to get past its bot checks, and none are set up.`
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (cookiesFilePath && existsSync(cookiesFilePath)) {
            const baseUrl = getBaseUrlFromHostname(hostname);
            try {
                await refreshCookiesWithYtDlp(cookiesFilePath, baseUrl);
            } catch (error) {
                console.warn('Failed to refresh cookies, continuing with existing cookies:', error);
            }
        }

        const { filePath, filename } = await downloadVideo(socialUrl, {
            format,
            quality,
            cookie,
            cookiesFilePath,
            sleep,
            retries,
        });

        const contentType = format === 'mp3' 
            ? 'audio/mpeg' 
            : 'video/mp4';

        // Streamed from disk: read whole, a long video would sit in this
        // server's memory for every import running at once.
        const { size } = await stat(filePath);
        const fileStream = createReadStream(filePath);
        fileStream.once('close', () => {
            rm(filePath, { force: true }).catch(() => {});
        });

        return new Response(Readable.toWeb(fileStream) as ReadableStream, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': String(size),
                'Content-Disposition': `attachment; filename="${filename}"`,
                                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });

    } catch (error) {
        console.error('Error downloading social media content:', error);
        return new Response(JSON.stringify({ error: 'An error occurred while processing your request' }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};