import express from 'express';
type Request = express.Request;
type Response = express.Response;
import { createCanvas, loadImage } from 'canvas';
import db from '../utils/database.js';
import { canAccessFile } from '../utils/auth.js';
import { applyHeavyBlur } from '../utils/blur/index.js';
import {
    defaultGithubBranch,
    defaultGithubRepoForSharedAssets,
    defaultGithubRepoForStoredFile,
    githubReposToTryForVideoCommentAttachment,
    githubRawFileUrl,
    isVideoFolderCommentAttachmentPath,
    resolveGithubRepoForFile,
} from '../utils/githubStorage.js';
import { getR2Client, r2PresignTtlSeconds } from '../utils/r2.js';
import { buildCacheKey, getMemoryCache } from '../utils/cache/memoryCache.js';
import {
    fileMetaCache,
    commentBackendCache,
    commentRepoCache,
    FILE_404_TTL_MS,
} from '../utils/cache/metadataCache.js';

// Cache TTLs + CDN directives for public, non-blurred, non-adult responses only.
const PUBLIC_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLIC_JSON_TTL_MS  = 60 * 60 * 1000;
const PUBLIC_CDN_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';
const PUBLIC_JSON_CDN_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

const router = express.Router();

/** Thrown when every GitHub fetch / decode attempt failed (route maps to 404). */
class ImageLoadExhaustedError extends Error {
    constructor(cause?: unknown) {
        super('All image load retries failed', cause !== undefined ? { cause } : undefined);
        this.name = 'ImageLoadExhaustedError';
    }
}

/** GitHub folder segment: DD_MM_YYYY (same as arrangeDateForThumbnail / Go upload). */
function formatDateFolder(day: number, month: number, year: number): string {
    return `${String(day).padStart(2, '0')}_${String(month).padStart(2, '0')}_${year}`;
}

function parseDateFolderPrefix(splitUrl: string): { day: number; month: number; year: number; rest: string } | null {
    const m = splitUrl.match(/^(\d{1,2})_(\d{1,2})_(\d{4})(\/.*)$/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const rest = m[4];
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        return null;
    }
    return { day, month, year, rest };
}

function addUtcCalendarDays(
    day: number,
    month: number,
    year: number,
    deltaDays: number,
): { day: number; month: number; year: number } {
    const d = new Date(Date.UTC(year, month - 1, day + deltaDays));
    return {
        day: d.getUTCDate(),
        month: d.getUTCMonth() + 1,
        year: d.getUTCFullYear(),
    };
}

/**
 * Retry paths after the original URL fails: fix `.jpg?…` / `.json?…` suffix, then try +1/+2/-1/-2 calendar days
 * on the DD_MM_YYYY folder (month/year roll over correctly; leap years handled in UTC).
 */
function buildImagePathRetryCandidates(initialPath: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();

    const push = (u: string) => {
        if (!seen.has(u)) {
            seen.add(u);
            out.push(u);
        }
    };

    const jpgFixed = initialPath.replace(/\.jpg.*$/i, '.jpg');
    if (jpgFixed !== initialPath) {
        push(jpgFixed);
    }

    const jsonFixed = initialPath.replace(/\.json.*$/i, '.json');
    if (jsonFixed !== initialPath) {
        push(jsonFixed);
    }

    const parsed = parseDateFolderPrefix(initialPath);
    if (parsed) {
        const { day, month, year, rest } = parsed;
        for (const delta of [1, 2, -1, -2] as const) {
            const n = addUtcCalendarDays(day, month, year, delta);
            push(`${formatDateFolder(n.day, n.month, n.year)}${rest}`);
        }
    }

    return out;
}

function buildGithubRawAttemptUrls(splitUrl: string): string[] {
    return [splitUrl, ...buildImagePathRetryCandidates(splitUrl).filter((u) => u !== splitUrl)];
}

async function fetchGithubJsonWithRetry(
    splitUrl: string,
    githubRepo: string,
    branch: string,
    urlResolver?: (urlPath: string) => string,
): Promise<string> {
    const owner = process.env.GITHUB_OWNER;
    if (!urlResolver && !owner) {
        throw new Error('GITHUB_OWNER is not set');
    }
    for (const path of buildGithubRawAttemptUrls(splitUrl)) {
        const rawUrl = urlResolver ? urlResolver(path) : githubRawFileUrl(owner!, githubRepo, branch, path);
        try {
            const res = await fetch(rawUrl);
            if (res.ok) {
                return await res.text();
            }
        } catch {
            /* try next path */
        }
    }
    throw new ImageLoadExhaustedError();
}

/** Fixes paths like `.../default_thumbnail.jpg/?quality=50` where a trailing slash breaks GitHub raw URLs. */
function normalizeGithubImagePath(raw: string | undefined): string | undefined {
    if (raw == null) return raw;
    let p = raw.trim();
    if (!p) return p;
    try {
        if (p.includes('%')) p = decodeURIComponent(p);
    } catch {
        /* keep p */
    }
    while (p.length > 1 && p.endsWith('/')) {
        p = p.slice(0, -1);
    }
    return p;
}

function githubImagePathFromRequest(req: Request): string {
    const noQuery = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    const base = req.baseUrl ?? '';
    if (base && noQuery.startsWith(base)) {
        return noQuery.slice(base.length).replace(/^\/+/, '');
    }
    let p = (req.path ?? '').replace(/^\/+/, '');
    const mountPrefix = 'api/load/image/';
    if (p.startsWith(mountPrefix)) {
        p = p.slice(mountPrefix.length);
    }
    return p;
}

let sharpModule: any = null;
const getSharp = async () => {
    if (sharpModule !== null) return sharpModule;
    try {
        sharpModule = await import('sharp');
        return sharpModule.default || sharpModule;
    } catch (e) {
        sharpModule = false;
        return null;
    }
};


interface ImageResult {
    buffer: Buffer;
    contentType: string;
    cacheControl: string;
}

const loadImageWithRetry = async (
    splitUrl: string,
    qualityParam: string | null,
    shouldBlur: boolean = false,
    githubRepo: string = defaultGithubRepoForStoredFile(),
    branch: string = defaultGithubBranch(),
    urlResolver?: (urlPath: string) => string,
): Promise<ImageResult> => {
    const owner = process.env.GITHUB_OWNER;
    if (!urlResolver && !owner) {
        throw new Error('GITHUB_OWNER is not set');
    }
    const tryLoadImage = async (urlPath: string): Promise<ImageResult> => {
        const videoUrl = urlResolver ? urlResolver(urlPath) : githubRawFileUrl(owner!, githubRepo, branch, urlPath);
        const response = await fetch(videoUrl);
    
        if (!response.ok) throw new Error('Fetch failed');
    
        const imageBuffer = await response.arrayBuffer();
        let buffer = Buffer.from(imageBuffer);
        
        const contentType = response.headers.get('content-type') || '';
        const isImageContentType = contentType.startsWith('image/');
        
        if (buffer.length < 12) {
            throw new Error(`Response too small to be a valid image. Size: ${buffer.length} bytes, URL: ${videoUrl}`);
        }
        
        const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        const isGIF = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
        const isWebP = buffer.length >= 12 && 
            buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
        
        if (!isPNG && !isJPEG && !isGIF && !isWebP) {
            const textStart = buffer.slice(0, 100).toString('utf-8').toLowerCase();
            if (textStart.includes('<html') || textStart.includes('<!doctype')) {
                throw new Error(`Received HTML instead of image. URL: ${videoUrl}, Content-Type: ${contentType}`);
            }
            const hexPreview = buffer.slice(0, 16).toString('hex');
            throw new Error(`Unsupported image type. Content-Type: ${contentType}, First bytes (hex): ${hexPreview}, URL: ${videoUrl}`);
        }
        
        // SECURITY: Always process if blur is required, regardless of quality parameter
        // Force processing if blur is needed to prevent bypassing access control
        let needsProcessing = shouldBlur;
        let scale = 1;
        if (qualityParam) {
            const qualityNum = parseFloat(qualityParam);
            if (!isNaN(qualityNum)) {
                if (qualityNum > 0 && qualityNum < 1) {
                    scale = qualityNum;
                    needsProcessing = true;
                } else if (qualityNum >= 1 && qualityNum <= 100) {
                    scale = qualityNum / 100;
                    if (scale !== 1) needsProcessing = true;
                }
            }
        }
        
        // SECURITY: CRITICAL - Never return unprocessed image if blur is required
        // This prevents bypassing access control via quality parameter or any other means
        // Always force processing when shouldBlur is true, regardless of format or quality
        if (shouldBlur) {
            needsProcessing = true;
        }
        
        // Only return unprocessed WebP if we don't need processing AND blur is not required
        if (isWebP && !needsProcessing && !shouldBlur) {
            return {
                buffer: buffer,
                contentType: 'image/webp',
                cacheControl: 'public, max-age=31536000, immutable'
            };
        }

        // Preserve animated GIF when not resizing/blurring (canvas path is first-frame-only / PNG).
        if (isGIF && !needsProcessing && !shouldBlur) {
            return {
                buffer: buffer,
                contentType: 'image/gif',
                cacheControl: 'public, max-age=31536000, immutable'
            };
        }
        
        if (isWebP && needsProcessing) {
            const sharp = await getSharp();
            if (sharp) {
                const pngBuffer = await sharp(buffer).png().toBuffer();
                buffer = Buffer.from(pngBuffer);
            } else {
                throw new Error(
                    `WebP format requires processing but 'sharp' package is not available. ` +
                    `Install 'sharp' package for WebP support. ` +
                    `URL: ${videoUrl}`
                );
            }
        }

        if (isGIF && needsProcessing) {
            const sharp = await getSharp();
            if (sharp) {
                try {
                    const pngBuffer = await sharp(buffer, { pages: 1 }).png().toBuffer();
                    buffer = Buffer.from(pngBuffer);
                } catch {
                    /* fall through to loadImage */
                }
            }
        }
    
        let image;
        try {
            image = await loadImage(buffer);
        } catch (loadError: any) {
            const hexPreview = buffer.slice(0, 16).toString('hex');
            const detectedFormat = isPNG ? 'PNG' : isJPEG ? 'JPEG' : isGIF ? 'GIF' : isWebP ? 'WebP' : 'Unknown';
            
            throw new Error(
                `Failed to load image (detected as ${detectedFormat}). ` +
                `Content-Type: ${contentType}, ` +
                `First bytes (hex): ${hexPreview}, ` +
                `Buffer size: ${buffer.length}, ` +
                `URL: ${videoUrl}, ` +
                `Error: ${loadError?.message || 'Unknown error'}`
            );
        }

        const w = Math.max(1, Math.round(image.width * scale));
        const h = Math.max(1, Math.round(image.height * scale));
        const canvas = createCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        
        // SECURITY: CRITICAL - Always apply blur if required, regardless of quality parameter
        // This ensures access control cannot be bypassed via ?quality= parameter
        // Double-check shouldBlur flag to prevent any bypass
        if (shouldBlur) {
            // Apply heavy blur to make patterns completely unseeable
            // Only color information will remain visible
            // Also adds "Login Required" text and app logo
            await applyHeavyBlur(canvas, 100);
        } else {
            // SECURITY: Log if blur was expected but not applied (for debugging)
            // This helps identify if shouldBlur flag is being set incorrectly
            // if (qualityParam) {
            //     console.warn(`[SECURITY] Image processed with quality=${qualityParam} but shouldBlur=false. This should be reviewed.`);
            // }
        }
        
        const processedBuffer = canvas.toBuffer('image/png');

        return {
            buffer: processedBuffer,
            contentType: 'image/png',
            cacheControl: shouldBlur ? 'public, max-age=3600' : 'public, max-age=31536000, immutable'
        };
    };

    const attemptUrls = buildGithubRawAttemptUrls(splitUrl);
    let lastError: unknown;
    for (const urlPath of attemptUrls) {
        try {
            return await tryLoadImage(urlPath);
        } catch (err) {
            lastError = err;
        }
    }
    throw new ImageLoadExhaustedError(lastError);
};

const wrapText = (ctx: any, text: string, maxWidth: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    
    if (currentLine) {
        lines.push(currentLine);
    }
    
    return lines;
};

const createTextImage = (text: string): Buffer => {
    const size = 400;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    const radius = size / 2;
    const padding = 80;
    const maxTextWidth = (radius - padding) * 2;
    const maxTextHeight = (radius - padding) * 2;
    
    let minFontSize = 12;
    let maxFontSize = 200;
    let fontSize = 100;
    let lines: string[] = [];
    
    while (maxFontSize - minFontSize > 1) {
        fontSize = Math.floor((minFontSize + maxFontSize) / 2);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        
        lines = wrapText(ctx, text, maxTextWidth);
        const lineHeight = fontSize * 1.2;
        const totalHeight = lines.length * lineHeight;
        
        const fitsWidth = lines.every(line => {
            const metrics = ctx.measureText(line);
            return metrics.width <= maxTextWidth;
        });
        const fitsHeight = totalHeight <= maxTextHeight;
        
        if (fitsWidth && fitsHeight) {
            minFontSize = fontSize;
        } else {
            maxFontSize = fontSize;
        }
    }
    
    fontSize = minFontSize;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines = wrapText(ctx, text, maxTextWidth);
    
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(radius, radius, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#000000';
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const startY = radius - (totalHeight / 2) + (lineHeight / 2);
    
    lines.forEach((line, index) => {
        const y = startY + (index * lineHeight);
        ctx.fillText(line, radius, y);
    });
    
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - radius;
            const dy = y - radius;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > radius) {
                const idx = (y * size + x) * 4;
                data[idx + 3] = 0;
            }
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    return canvas.toBuffer('image/png');
};

const getFileFromPath = async (path: string): Promise<any> => {
    if (!db) return null;
    const pathParts = path.split('/');
    if (pathParts.length <= 2) return null;

    // Cache by uniqueId — multiple paths under the same upload share metadata.
    const uniqueId = pathParts[1]!;
    const hit = fileMetaCache.get(uniqueId);
    if (hit !== undefined) return hit;

    const { data } = await db
        .from('files')
        .select('id, is_adult, is_public, visibility, owner_id, upload_status, github_repo, storage_backend, storage_bucket')
        .eq('unique_id', uniqueId)
        .maybeSingle();

    const value = data || null;
    // Negative caching prevents 404 floods from hammering the DB.
    fileMetaCache.set(uniqueId, value, value === null ? FILE_404_TTL_MS : undefined);
    return value;

    // if (path.includes('_thumb_')) {
    //     const uniqueIdMatch = path.match(/([^\/]+)_thumb_\d+\.jpg/);
    //     if (uniqueIdMatch) {
    //         const uniqueId = uniqueIdMatch[1];
    //         const { data } = await db
    //             .from('files')
    //             .select('*')
    //             .eq('unique_id', uniqueId)
    //             .maybeSingle();
    //         file = data;
    //     }
    // } else if (pathParts.length >= 2) {
    //     const uniqueId = pathParts[pathParts.length - 2];
    //     const { data } = await db
    //         .from('files')
    //         .select('*')
    //         .eq('unique_id', uniqueId)
    //         .maybeSingle();
    //     file = data;
    // } else if (path.includes('thumbnail_')) {
    //     const uniqueIdMatch = path.match(/\/([^\/]+)\/thumbnail_/);
    //     if (uniqueIdMatch) {
    //         const uniqueId = uniqueIdMatch[1];
    //         const { data } = await db
    //             .from('files')
    //             .select('*')
    //             .eq('unique_id', uniqueId)
    //             .maybeSingle();
    //         file = data;
    //     }
    // } else {
    //     const { data } = await db
    //         .from('files')
    //         .select('*')
    //         .eq('endpoint', path)
    //         .maybeSingle();
    //     file = data;
    // }

};

// Backend for a standalone comment image (`comment-images/...`): comment row first,
// then the staging table set by the GoUpload webhook before the comment is created.
async function lookupCommentImageBackend(storagePath: string): Promise<'github' | 'r2'> {
    if (!db) return 'github';
    const hit = commentBackendCache.get(storagePath);
    if (hit !== undefined) return hit;
    try {
        const { data: c } = await db
            .from('comments')
            .select('storage_backend')
            .eq('image_url', storagePath)
            .maybeSingle();
        let result: 'github' | 'r2';
        if ((c as { storage_backend?: string | null } | null)?.storage_backend === 'r2') result = 'r2';
        else if (c) result = 'github';
        else {
            const { data: pending } = await db
                .from('comment_image_upload_repos')
                .select('storage_backend')
                .eq('storage_path', storagePath)
                .maybeSingle();
            result = (pending as { storage_backend?: string | null } | null)?.storage_backend === 'r2' ? 'r2' : 'github';
        }
        commentBackendCache.set(storagePath, result);
        return result;
    } catch {
        return 'github';
    }
}

async function lookupCommentImageGithubRepo(storagePath: string): Promise<string | null> {
    if (!db) return null;
    const hit = commentRepoCache.get(storagePath);
    if (hit !== undefined) return hit;
    try {
        const { data, error } = await db
            .from('comments')
            .select('image_github_repo')
            .eq('image_url', storagePath)
            .maybeSingle();
        if (error || !data) {
            commentRepoCache.set(storagePath, null);
            return null;
        }
        const r = (data as { image_github_repo?: string | null }).image_github_repo;
        const value = typeof r === 'string' && r.trim() ? r.trim() : null;
        commentRepoCache.set(storagePath, value);
        return value;
    } catch {
        return null;
    }
}

// Handle OPTIONS preflight requests
router.options('/*', (req: Request, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Cookie, c-user, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(204);
});

router.get('/*', async (req: Request, res: Response) => {
    try {
        const qualityParam = req.query.quality as string | null;
        const textParam = req.query.text as string | null;


        if (textParam) {
            const buffer = createTextImage(textParam);
            res.set({
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=3600',
            });
            return res.send(buffer);
        }

        const rawPath = githubImagePathFromRequest(req);
        const splitUrl = normalizeGithubImagePath(rawPath);

        if (!splitUrl) {
            return res.status(404).send(null);
        }

        const cache = getMemoryCache();

        // Comment images are public, just proxy. Backend can be R2 (recent
        // uploads) or GitHub (legacy)  comment row + staging table tell us.
        if (splitUrl.startsWith('comment-images/')) {
            const backend = await lookupCommentImageBackend(splitUrl);
            const cacheKey = buildCacheKey({
                path: splitUrl,
                quality: qualityParam,
                blur: false,
                backend: backend === 'r2' ? 'r2' : 'gh',
            });
            const cached = cache.get(cacheKey);
            if (cached) {
                res.set({
                    'Content-Type': cached.contentType,
                    'Cache-Control': cached.cacheControl,
                    'CDN-Cache-Control': PUBLIC_CDN_CACHE,
                    'Vercel-CDN-Cache-Control': PUBLIC_CDN_CACHE,
                    'X-Cache': 'HIT',
                });
                return res.send(cached.buffer);
            }

            let result;
            if (backend === 'r2') {
                const r2 = getR2Client();
                if (!r2) return res.status(503).send(null);
                const ttl = r2PresignTtlSeconds();
                const r2Resolver = (urlPath: string) => r2.presignGet(urlPath, ttl);
                result = await loadImageWithRetry(
                    splitUrl,
                    qualityParam,
                    false,
                    '',
                    '',
                    r2Resolver,
                );
            } else {
                result = await loadImageWithRetry(
                    splitUrl,
                    qualityParam,
                    false,
                    defaultGithubRepoForSharedAssets(),
                    defaultGithubBranch(),
                );
            }
            cache.set(cacheKey, result.buffer, result.contentType, result.cacheControl, PUBLIC_IMAGE_TTL_MS);
            res.set({
                'Content-Type': result.contentType,
                'Cache-Control': result.cacheControl,
                'CDN-Cache-Control': PUBLIC_CDN_CACHE,
                'Vercel-CDN-Cache-Control': PUBLIC_CDN_CACHE,
                'X-Cache': 'MISS',
            });
            return res.send(result.buffer);
        }

        // SECURITY: CRITICAL - Check access BEFORE fetching image from GitHub
        // This ensures we know if we should blur before making any external requests
        const file = await getFileFromPath(splitUrl);
        // if the file is not found, return 404
        if(!file){
            return res.status(404).send(null);
        }

        // Determine if we should blur the image BEFORE fetching
        let shouldBlur = false;
        if (file) {
            const hasAccess = await canAccessFile(req, file);
            if (!hasAccess && file.is_adult) {
                shouldBlur = true;
            }
            // Video-folder comment PNGs: same as comment-images/  still proxy; optional blur from parent is_adult.
            // Do not 403 private parents (avoids broken <img> for comment attachments).
            const isVideoFolderComment = isVideoFolderCommentAttachmentPath(splitUrl);
            if (!isVideoFolderComment && !hasAccess && !file.is_public && !file.is_adult) {
                return res.status(403).json({
                    error: 'Access denied. You do not have permission to view this file.',
                });
            }
        } else {
            // SECURITY: If file not found in database, we can't verify access
            // For security, we should still check if the URL suggests adult content
            // But to be safe, we'll allow the image to load (it might be a public file)
            // The main security is handled by the file lookup - if it's in the DB and is_adult, blur is applied
        }

        // Only cache responses that don't depend on viewer identity AND
        // belong to a finished upload (mid-upload bytes can still change).
        const isUploadComplete = file.upload_status === 'complete' || file.upload_status === 'completed';
        const isCacheable = !shouldBlur && file.is_public === true && file.is_adult !== true && isUploadComplete;
        const cdnDirective = isCacheable ? PUBLIC_CDN_CACHE : 'no-store';
        const cdnJsonDirective = isCacheable ? PUBLIC_JSON_CDN_CACHE : 'no-store';

        // R2-backed files: presign + proxy. Bucket stays private, same as the
        // GitHub-raw path. shouldBlur still applies (processing is buffer-based).
        if (file.storage_backend === 'r2') {
            const r2 = getR2Client();
            if (!r2) {
                return res.status(503).send(null);
            }
            const ttl = r2PresignTtlSeconds();
            const r2Resolver = (urlPath: string) => r2.presignGet(urlPath, ttl);

            const isJson = splitUrl.toLowerCase().endsWith('.json');
            const cacheKey = buildCacheKey({
                path: splitUrl,
                quality: qualityParam,
                blur: shouldBlur,
                backend: 'r2',
            });

            if (isCacheable) {
                const cached = cache.get(cacheKey);
                if (cached) {
                    res.set({
                        'Content-Type': cached.contentType,
                        'Cache-Control': cached.cacheControl,
                        'CDN-Cache-Control': cdnDirective,
                        'Vercel-CDN-Cache-Control': cdnDirective,
                        'X-Cache': 'HIT',
                    });
                    return res.send(cached.buffer);
                }
            }

            if (isJson) {
                const body = await fetchGithubJsonWithRetry(splitUrl, '', '', r2Resolver);
                const jsonBuf = Buffer.from(body, 'utf-8');
                if (isCacheable) {
                    cache.set(cacheKey, jsonBuf, 'application/json', 'public, max-age=300', PUBLIC_JSON_TTL_MS);
                }
                res.set({
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=300',
                    'CDN-Cache-Control': cdnJsonDirective,
                    'Vercel-CDN-Cache-Control': cdnJsonDirective,
                    'X-Cache': isCacheable ? 'MISS' : 'BYPASS',
                });
                return res.send(body);
            }
            const result = await loadImageWithRetry(splitUrl, qualityParam, shouldBlur, '', '', r2Resolver);
            if (isCacheable) {
                cache.set(cacheKey, result.buffer, result.contentType, result.cacheControl, PUBLIC_IMAGE_TTL_MS);
            }
            res.set({
                'Content-Type': result.contentType,
                'Cache-Control': result.cacheControl,
                'CDN-Cache-Control': cdnDirective,
                'Vercel-CDN-Cache-Control': cdnDirective,
                'X-Cache': isCacheable ? 'MISS' : 'BYPASS',
            });
            return res.send(result.buffer);
        }

        const branch = defaultGithubBranch();
        let commentImageRepo: string | null = null;
        if (isVideoFolderCommentAttachmentPath(splitUrl)) {
            commentImageRepo = await lookupCommentImageGithubRepo(splitUrl);
        }
        const repos = isVideoFolderCommentAttachmentPath(splitUrl)
            ? githubReposToTryForVideoCommentAttachment(file, commentImageRepo)
            : [resolveGithubRepoForFile(file)];

        // Key by path, not repo — the multi-repo fallback returns the same body.
        const ghCacheKey = buildCacheKey({
            path: splitUrl,
            quality: qualityParam,
            blur: shouldBlur,
            backend: 'gh',
        });

        if (splitUrl.toLowerCase().endsWith('.json')) {
            if (isCacheable) {
                const cached = cache.get(ghCacheKey);
                if (cached) {
                    res.set({
                        'Content-Type': cached.contentType,
                        'Cache-Control': cached.cacheControl,
                        'CDN-Cache-Control': cdnJsonDirective,
                        'Vercel-CDN-Cache-Control': cdnJsonDirective,
                        'X-Cache': 'HIT',
                    });
                    return res.send(cached.buffer);
                }
            }
            let lastExhausted: ImageLoadExhaustedError | null = null;
            for (const repo of repos) {
                try {
                    const body = await fetchGithubJsonWithRetry(splitUrl, repo, branch);
                    if (isCacheable) {
                        cache.set(ghCacheKey, Buffer.from(body, 'utf-8'), 'application/json', 'public, max-age=300', PUBLIC_JSON_TTL_MS);
                    }
                    res.set({
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=300',
                        'CDN-Cache-Control': cdnJsonDirective,
                        'Vercel-CDN-Cache-Control': cdnJsonDirective,
                        'X-Cache': isCacheable ? 'MISS' : 'BYPASS',
                    });
                    return res.send(body);
                } catch (e) {
                    if (e instanceof ImageLoadExhaustedError) lastExhausted = e;
                    else throw e;
                }
            }
            if (lastExhausted) throw lastExhausted;
            throw new Error('No GitHub repo candidates for path');
        }

        if (isCacheable) {
            const cached = cache.get(ghCacheKey);
            if (cached) {
                res.set({
                    'Content-Type': cached.contentType,
                    'Cache-Control': cached.cacheControl,
                    'CDN-Cache-Control': cdnDirective,
                    'Vercel-CDN-Cache-Control': cdnDirective,
                    'X-Cache': 'HIT',
                });
                return res.send(cached.buffer);
            }
        }

        // SECURITY: Now fetch image with shouldBlur flag already determined
        let lastExhausted: ImageLoadExhaustedError | null = null;
        for (const repo of repos) {
            try {
                const result = await loadImageWithRetry(splitUrl, qualityParam, shouldBlur, repo, branch);
                if (isCacheable) {
                    cache.set(ghCacheKey, result.buffer, result.contentType, result.cacheControl, PUBLIC_IMAGE_TTL_MS);
                }
                res.set({
                    'Content-Type': result.contentType,
                    'Cache-Control': result.cacheControl,
                    'CDN-Cache-Control': cdnDirective,
                    'Vercel-CDN-Cache-Control': cdnDirective,
                    'X-Cache': isCacheable ? 'MISS' : 'BYPASS',
                });
                return res.send(result.buffer);
            } catch (e) {
                if (e instanceof ImageLoadExhaustedError) lastExhausted = e;
                else throw e;
            }
        }
        if (lastExhausted) throw lastExhausted;
        throw new Error('No GitHub repo candidates for path');
    } catch (error) {
        if (error instanceof ImageLoadExhaustedError) {
            return res.status(404).send(null);
        }
        return res.status(500).send();
    }
});

export default router;
