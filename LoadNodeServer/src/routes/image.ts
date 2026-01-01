import express from 'express';
type Request = express.Request;
type Response = express.Response;
import { createCanvas, loadImage } from 'canvas';
import db from '../utils/database.js';
import { canAccessFile } from '../utils/auth.js';
import { sanitizeFilePath } from '../utils/security.js';

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

const applyBlur = (canvas: any, blurRadius: number = 30): void => {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    const radius = Math.min(Math.max(Math.floor(blurRadius), 5), 40);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const tempData = new Uint8ClampedArray(data);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, count = 0;
            const startX = Math.max(0, x - radius);
            const endX = Math.min(width - 1, x + radius);
            
            for (let nx = startX; nx <= endX; nx++) {
                const idx = (y * width + nx) * 4;
                r += tempData[idx];
                g += tempData[idx + 1];
                b += tempData[idx + 2];
                count++;
            }
            
            const idx = (y * width + x) * 4;
            data[idx] = Math.floor(r / count);
            data[idx + 1] = Math.floor(g / count);
            data[idx + 2] = Math.floor(b / count);
        }
    }
    
    const horizontalBlurred = new Uint8ClampedArray(data);
    
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let r = 0, g = 0, b = 0, count = 0;
            const startY = Math.max(0, y - radius);
            const endY = Math.min(height - 1, y + radius);
            
            for (let ny = startY; ny <= endY; ny++) {
                const idx = (ny * width + x) * 4;
                r += horizontalBlurred[idx];
                g += horizontalBlurred[idx + 1];
                b += horizontalBlurred[idx + 2];
                count++;
            }
            
            const idx = (y * width + x) * 4;
            data[idx] = Math.floor(r / count);
            data[idx + 1] = Math.floor(g / count);
            data[idx + 2] = Math.floor(b / count);
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, width, height);
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
        
        if (isWebP && !needsProcessing) {
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
        
        if (shouldBlur) {
            applyBlur(canvas, 40);
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
    let file = null;

    if (path.includes('_thumb_')) {
        const uniqueIdMatch = path.match(/([^\/]+)_thumb_\d+\.jpg/);
        if (uniqueIdMatch) {
            const uniqueId = uniqueIdMatch[1];
            const { data } = await db
                .from('files')
                .select('*')
                .eq('unique_id', uniqueId)
                .maybeSingle();
            file = data;
        }
    } else if (pathParts.length >= 2) {
        const uniqueId = pathParts[pathParts.length - 2];
        const { data } = await db
            .from('files')
            .select('*')
            .eq('unique_id', uniqueId)
            .maybeSingle();
        file = data;
    } else if (path.includes('thumbnail_')) {
        const uniqueIdMatch = path.match(/\/([^\/]+)\/thumbnail_/);
        if (uniqueIdMatch) {
            const uniqueId = uniqueIdMatch[1];
            const { data } = await db
                .from('files')
                .select('*')
                .eq('unique_id', uniqueId)
                .maybeSingle();
            file = data;
        }
    } else {
        const { data } = await db
            .from('files')
            .select('*')
            .eq('endpoint', path)
            .maybeSingle();
        file = data;
    }

    return file;
};

router.get('/*', async (req: Request, res: Response) => {
    try {
        const qualityParam = req.query.quality as string | null;
        const textParam = req.query.text as string | null;
        
        if (textParam) {
            const buffer = createTextImage(textParam);
            res.set({
                'Content-Type': 'image/png',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=3600',
            });
            return res.send(buffer);
        }
        
        let splitUrl = req.path.substring(1);
        if (splitUrl.includes(`%`)) {
            splitUrl = decodeURIComponent(splitUrl);
        }

        const file = await getFileFromPath(splitUrl);
        
        if (file) {
            const hasAccess = await canAccessFile(req, file);
            if (!hasAccess && file.is_adult) {
                const result = await loadImageWithRetry(splitUrl, qualityParam, true);
                res.set({
                    'Content-Type': result.contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': result.cacheControl,
                });
                return res.send(result.buffer);
            }
        }

        const result = await loadImageWithRetry(splitUrl, qualityParam, false);
        res.set({
            'Content-Type': result.contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': result.cacheControl,
        });
        return res.send(result.buffer);
    } catch (error) {
        console.error('Error loading image:', error);
        return res.status(500).send();
    }
});

export default router;
