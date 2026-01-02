import express from 'express';
type Request = express.Request;
type Response = express.Response;
import { createCanvas, loadImage } from 'canvas';
import db from '../utils/database.js';
import { canAccessFile } from '../utils/auth.js';
import { applyHeavyBlur } from '../utils/blur/index.js';

const router = express.Router();


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

const loadImageWithRetry = async (splitUrl: string, qualityParam: string | null, shouldBlur: boolean = false): Promise<ImageResult> => {
    const tryLoadImage = async (urlPath: string): Promise<ImageResult> => {
        const videoUrl = `https://github.com/${process.env.GITHUB_OWNER}/Memories/raw/main/${urlPath}`;
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

        const canvas = createCanvas(
            Math.round(image.width * scale),
            Math.round(image.height * scale)
        );
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

    if(pathParts.length > 2){
        const uniqueId = pathParts[1];
        const { data } = await db
            .from('files')
            .select('*')
            .eq('unique_id', uniqueId)
            .maybeSingle();

        return data || null;
    }


    return null

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
        
        let splitUrl = req.path.substring(1);
        // Remove query string if present (shouldn't be in req.path, but be safe)
        if (splitUrl.includes('?')) {
            splitUrl = splitUrl.split('?')[0];
        }
        if (splitUrl.includes(`%`)) {
            splitUrl = decodeURIComponent(splitUrl);
        }

        // SECURITY: CRITICAL - Check access BEFORE fetching image from GitHub
        // This ensures we know if we should blur before making any external requests
        const file = await getFileFromPath(splitUrl);
        // if the file is not found, return 404
        if(!file){
            return res.status(404).send(null);
        }
        
        // Determine if we should blur the image BEFORE fetching
        // SECURITY: Default to blurring if we can't verify the file exists
        let shouldBlur = false;
        if (file) {
            // console.log('file:', file);
            // Check access BEFORE fetching image
            const hasAccess = await canAccessFile(req, file);
            // Show blurred image for unauthenticated/underage users viewing adult content
            if (!hasAccess && file.is_adult) {
                shouldBlur = true;
            }
            // Block private content for users without access
            if (!hasAccess && !file.is_public && !file.is_adult) {
                return res.status(403).json({ 
                    error: 'Access denied. You do not have permission to view this file.' 
                });
            }
        } else {
            // SECURITY: If file not found in database, we can't verify access
            // For security, we should still check if the URL suggests adult content
            // But to be safe, we'll allow the image to load (it might be a public file)
            // The main security is handled by the file lookup - if it's in the DB and is_adult, blur is applied
        }

        // SECURITY: Now fetch image with shouldBlur flag already determined
        // The shouldBlur flag is set BEFORE this call, ensuring access control is enforced
        const result = await loadImageWithRetry(splitUrl, qualityParam, shouldBlur);
        res.set({
            'Content-Type': result.contentType,
            'Cache-Control': result.cacheControl,  // browser can still cache
            'CDN-Cache-Control': 'no-store',        // but Vercel edge won't
            'Vercel-CDN-Cache-Control': 'no-store',
        });
        return res.send(result.buffer);
    } catch (error) {
        console.error('Error loading image:', error);
        return res.status(500).send();
    }
});

export default router;
