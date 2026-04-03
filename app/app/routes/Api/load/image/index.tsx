import { createCanvas, loadImage } from 'canvas';
import db from '~/lib/Database/supabase';
import {
    drawImageLetterboxedInSquare,
    SERVER_METADATA_SQUARE_SIZE,
} from '~/lib/image/letterboxToSquare';
import { canAccessFile } from '~/routes/Api/fun/accessControl';
import { applyHeavyBlur } from '~/lib/blur/index';
import {
    defaultGithubBranch,
    defaultGithubRepoForSharedAssets,
    defaultGithubRepoForStoredFile,
    githubRawFileUrl,
    resolveGithubRepoForFile,
} from '~/lib/githubStorage';

/** Thrown when every GitHub fetch / decode attempt failed (loader maps to 404). */
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

/** Same date-folder alternates as images; used for `thumbnail_preview.json` and other GitHub JSON next to media. */
function buildGithubRawAttemptUrls(splitUrl: string): string[] {
    return [splitUrl, ...buildImagePathRetryCandidates(splitUrl).filter((u) => u !== splitUrl)];
}

async function fetchGithubJsonWithRetry(
    splitUrl: string,
    githubRepo: string,
    branch: string,
): Promise<Response> {
    const owner = process.env.GITHUB_OWNER;
    if (!owner) {
        throw new Error('GITHUB_OWNER is not set');
    }
    let lastError: unknown;
    for (const path of buildGithubRawAttemptUrls(splitUrl)) {
        const rawUrl = githubRawFileUrl(owner, githubRepo, branch, path);
        try {
            const res = await fetch(rawUrl);
            if (res.ok) {
                const body = await res.text();
                return new Response(body, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=300',
                    },
                });
            }
        } catch (e) {
            lastError = e;
        }
    }
    throw new ImageLoadExhaustedError(lastError);
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


const loadImageWithRetry = async (
    splitUrl: string,
    qualityParam: string | null,
    shouldBlur: boolean = false,
    isMetadata: boolean = false,
    githubRepo: string = defaultGithubRepoForStoredFile(),
    branch: string = defaultGithubBranch(),
): Promise<Response> => {
    const owner = process.env.GITHUB_OWNER;
    if (!owner) {
        throw new Error('GITHUB_OWNER is not set');
    }
    const tryLoadImage = async (urlPath: string): Promise<Response> => {
        const videoUrl = githubRawFileUrl(owner, githubRepo, branch, urlPath);
        const response = await fetch(videoUrl);
    
        if (!response.ok) throw new Error('Fetch failed');
    
        // Get the image buffer first
        const imageBuffer = await response.arrayBuffer();
        let buffer = Buffer.from(imageBuffer);
        
        // Check if the response is actually an image
        const contentType = response.headers.get('content-type') || '';
        const isImageContentType = contentType.startsWith('image/');
        
        // Always validate the image format by checking magic bytes
        if (buffer.length < 12) {
            throw new Error(`Response too small to be a valid image. Size: ${buffer.length} bytes, URL: ${videoUrl}`);
        }
        
        // Check the first few bytes to determine if it's an image
        const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        const isGIF = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
        // WebP: RIFF (bytes 0-3) then WEBP (bytes 8-11)
        const isWebP = buffer.length >= 12 && 
            buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
        
        if (!isPNG && !isJPEG && !isGIF && !isWebP) {
            // Try to detect if it's HTML or text
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

        // Metadata / OG thumbnails: always run through canvas (letterboxed square), never raw WebP passthrough
        if (isMetadata) {
            needsProcessing = true;
        }
        
        // Only return unprocessed WebP if we don't need processing AND blur is not required
        if (isWebP && !needsProcessing && !shouldBlur) {
            return new Response(new Uint8Array(buffer), {
                status: 200,
                headers: {
                    'Content-Type': 'image/webp',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            });
        }

        // Preserve animated GIF when not resizing/blurring/metadata (canvas path is first-frame-only / PNG).
        if (isGIF && !needsProcessing && !shouldBlur && !isMetadata) {
            return new Response(new Uint8Array(buffer), {
                status: 200,
                headers: {
                    'Content-Type': 'image/gif',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            });
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

        // Animated GIF + resize/blur/metadata: rasterize first page with sharp when available (canvas is flaky on some GIFs).
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
        } catch (loadError: unknown) {
            const hexPreview = buffer.slice(0, 16).toString('hex');
            const detectedFormat = isPNG ? 'PNG' : isJPEG ? 'JPEG' : isGIF ? 'GIF' : isWebP ? 'WebP' : 'Unknown';
            console.error('[load/image] decode failed', {
                detectedFormat,
                contentType,
                hexPreview,
                bufferLength: buffer.length,
                videoUrl,
                loadError,
            });
            throw new Error('Failed to decode image');
        }

        let canvas;
        if (isMetadata) {
            const S = SERVER_METADATA_SQUARE_SIZE;
            canvas = createCanvas(S, S);
            const ctx = canvas.getContext('2d');
            drawImageLetterboxedInSquare(ctx, image, S, scale);
        } else {
            const w = Math.max(1, Math.round(image.width * scale));
            const h = Math.max(1, Math.round(image.height * scale));
            canvas = createCanvas(w, h);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        }
        
        // SECURITY: CRITICAL - Always apply blur if required, regardless of quality parameter
        // This ensures access control cannot be bypassed via ?quality= parameter
        if (shouldBlur) {
            // Apply heavy blur to make patterns completely unseeable
            // Only color information will remain visible
            // Also adds "Login Required" text and app logo
            await applyHeavyBlur(canvas, 100);
        }
        
        const processedBuffer = canvas.toBuffer('image/png');

        // console.log('Processed buffer:', processedBuffer.length);
        return new Response(new Uint8Array(processedBuffer), {
            status: 200,
            headers: {
                'Content-Type': `image/png`,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': shouldBlur ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
            },
        });
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

const createTextImage = (text: string): Response => {
  const size = 400;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Circle radius (with increased padding from edges)
  const radius = size / 2;
  const padding = 80; // Increased padding to prevent overflow
  const maxTextWidth = (radius - padding) * 2;
  const maxTextHeight = (radius - padding) * 2; // Maximum height for circular constraint
  
  // Binary search for optimal font size
  let minFontSize = 12;
  let maxFontSize = 200;
  let fontSize = 100;
  let lines: string[] = [];
  
  while (maxFontSize - minFontSize > 1) {
    fontSize = Math.floor((minFontSize + maxFontSize) / 2);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    
    // Wrap text and check if it fits
    lines = wrapText(ctx, text, maxTextWidth);
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    
    // Check if text fits within circle (both width and height constraints)
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
  
  // Draw circular background
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(radius, radius, radius, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw text
  ctx.fillStyle = '#000000';
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  const startY = radius - (totalHeight / 2) + (lineHeight / 2);
  
  lines.forEach((line, index) => {
    const y = startY + (index * lineHeight);
    ctx.fillText(line, radius, y);
  });
  
  // Create circular mask by clearing outside the circle
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = imageData.data;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - radius;
      const dy = y - radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > radius) {
        const idx = (y * size + x) * 4;
        data[idx + 3] = 0; // Set alpha to 0 (transparent)
      }
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  // Convert to buffer and return
  const buffer = canvas.toBuffer('image/png');
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};

const getFileFromPath = async (path: string): Promise<any> => {
  if (!db) return null;

  const pathParts = path.split('/');

  if(pathParts.length > 2){
    const uniqueId = pathParts[1];
    const { data } = await db
      .from('files')
      .select('id, is_adult, is_public, owner_id, upload_status, github_repo')
      .eq('unique_id', uniqueId)
      .maybeSingle();
    return data || null;
  }

  return null;

  // if (path.includes('_thumb_')) {
  //   const uniqueIdMatch = path.match(/([^\/]+)_thumb_\d+\.jpg/);
  //   if (uniqueIdMatch) {
  //     const uniqueId = uniqueIdMatch[1];
  //     const { data } = await db
  //       .from('files')
  //       .select('*')
  //       .eq('unique_id', uniqueId)
  //       .maybeSingle();
  //     file = data;
  //   }
  // } else if (pathParts.length >= 2) {
  //   const uniqueId = pathParts[pathParts.length - 2];
  //   const { data } = await db
  //     .from('files')
  //     .select('*')
  //     .eq('unique_id', uniqueId)
  //     .maybeSingle();
  //   file = data;
  // } else if (path.includes('thumbnail_')) {
  //   const uniqueIdMatch = path.match(/\/([^\/]+)\/thumbnail_/);
  //   if (uniqueIdMatch) {
  //     const uniqueId = uniqueIdMatch[1];
  //     const { data } = await db
  //       .from('files')
  //       .select('*')
  //       .eq('unique_id', uniqueId)
  //       .maybeSingle();
  //     file = data;
  //   }
  // } else {
  //   const { data } = await db
  //     .from('files')
  //     .select('*')
  //     .eq('endpoint', path)
  //     .maybeSingle();
  //   file = data;
  // }

  // return file;
};

export const loader = async ({ request }: { request: Request }) => {
    try {
        const url = new URL(request.url);
        const qualityParam = url.searchParams.get('quality');
        const textParam = url.searchParams.get('text');
        const isMetadata = url.searchParams.get('is_metadata') === 'true';
        
        // Handle text-to-image generation
        if (textParam) {
          return createTextImage(textParam);
        }
        
        let splitUrl = normalizeGithubImagePath(
            request.url?.split('/api/load/image/')[1]?.split('?')[0],
        );

        if (!splitUrl) {
            return new Response(null, { status: 404 });
        }

        // Comment images are public — no access control needed, just proxy from GitHub
        if (splitUrl.startsWith('comment-images/')) {
            return await loadImageWithRetry(
                splitUrl,
                qualityParam,
                false,
                isMetadata,
                defaultGithubRepoForSharedAssets(),
                defaultGithubBranch(),
            );
        }

        // SECURITY: CRITICAL - Check access BEFORE fetching image from GitHub
        // This ensures we know if we should blur before making any external requests
        const file = await getFileFromPath(splitUrl);
        if(!file){
            return new Response(null, { status: 404 });
        }

        // Determine if we should blur the image BEFORE fetching
        // SECURITY: Check access before fetching to enforce access control
        let shouldBlur = false;
        if (file) {
            // Check access BEFORE fetching image
            const hasAccess = await canAccessFile(request, file);
            // Show blurred image for unauthenticated/underage users viewing adult content
            if (!hasAccess && file.is_adult) {
                shouldBlur = true;
            }
            // Block private content for users without access
            if (!hasAccess && !file.is_public && !file.is_adult) {
                return new Response(
                    JSON.stringify({ error: 'Access denied. You do not have permission to view this file.' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
        }

        const repo = resolveGithubRepoForFile(file);
        const branch = defaultGithubBranch();

        if (splitUrl.toLowerCase().endsWith('.json')) {
            return await fetchGithubJsonWithRetry(splitUrl, repo, branch);
        }

        // SECURITY: Now fetch image with shouldBlur flag already determined
        return await loadImageWithRetry(splitUrl, qualityParam, shouldBlur, isMetadata, repo, branch);
    } catch (error) {
        if (error instanceof ImageLoadExhaustedError) {
            return new Response(null, { status: 404 });
        }
        return new Response(null, { status: 500 });
    }
};