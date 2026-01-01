/**
 * Advanced blur processor for obscuring adult content
 * Uses multiple blur passes and color averaging to ensure patterns are unseeable
 */

import { loadImage } from 'canvas';
import { getServerToServerBaseURL } from '../url.js';

/**
 * Applies a heavy blur effect to a canvas, making patterns completely unseeable
 * Only color information remains visible
 * Adds "Login Required" text and app logo overlay
 * 
 * @param canvas - The canvas element to blur
 * @param blurRadius - The blur radius (default: 80 for heavy blur)
 */
export const applyHeavyBlur = async (canvas: any, blurRadius: number = 80): Promise<void> => {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Use a much larger radius for heavy blur (80-120 pixels)
    const radius = Math.min(Math.max(Math.floor(blurRadius), 60), 120);
    
    // Get initial image data
    let imageData = ctx.getImageData(0, 0, width, height);
    let data = imageData.data;
    
    // Apply multiple blur passes for stronger effect
    const passes = 3;
    
    for (let pass = 0; pass < passes; pass++) {
        const tempData = new Uint8ClampedArray(data);
        
        // Horizontal blur pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, count = 0;
                const startX = Math.max(0, x - radius);
                const endX = Math.min(width - 1, x + radius);
                
                // Sample more pixels for smoother blur
                const step = Math.max(1, Math.floor(radius / 20));
                for (let nx = startX; nx <= endX; nx += step) {
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
        
        // Vertical blur pass
        const horizontalBlurred = new Uint8ClampedArray(data);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                let r = 0, g = 0, b = 0, count = 0;
                const startY = Math.max(0, y - radius);
                const endY = Math.min(height - 1, y + radius);
                
                // Sample more pixels for smoother blur
                const step = Math.max(1, Math.floor(radius / 20));
                for (let ny = startY; ny <= endY; ny += step) {
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
    }
    
    // Apply additional color averaging to remove any remaining patterns
    applyColorAveraging(data, width, height, radius);
    
    // Apply dark overlay to further obscure content
    ctx.putImageData(imageData, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, width, height);
    
    // Add text and logo overlay
    await addLoginRequiredOverlay(ctx, width, height);
};

/**
 * Applies color averaging to remove fine patterns
 * Groups pixels into larger blocks and averages their colors
 */
const applyColorAveraging = (data: Uint8ClampedArray, width: number, height: number, blockSize: number): void => {
    const block = Math.max(8, Math.floor(blockSize / 4));
    const tempData = new Uint8ClampedArray(data);
    
    for (let by = 0; by < height; by += block) {
        for (let bx = 0; bx < width; bx += block) {
            let r = 0, g = 0, b = 0, count = 0;
            
            // Average all pixels in this block
            for (let y = by; y < Math.min(by + block, height); y++) {
                for (let x = bx; x < Math.min(bx + block, width); x++) {
                    const idx = (y * width + x) * 4;
                    r += tempData[idx];
                    g += tempData[idx + 1];
                    b += tempData[idx + 2];
                    count++;
                }
            }
            
            if (count > 0) {
                const avgR = Math.floor(r / count);
                const avgG = Math.floor(g / count);
                const avgB = Math.floor(b / count);
                
                // Apply averaged color to all pixels in block
                for (let y = by; y < Math.min(by + block, height); y++) {
                    for (let x = bx; x < Math.min(bx + block, width); x++) {
                        const idx = (y * width + x) * 4;
                        data[idx] = avgR;
                        data[idx + 1] = avgG;
                        data[idx + 2] = avgB;
                    }
                }
            }
        }
    }
};

/**
 * Adds "Login Required" text and app logo overlay to the blurred canvas
 * Logo position is randomly chosen (top or bottom)
 */
const addLoginRequiredOverlay = async (ctx: any, width: number, height: number): Promise<void> => {
    try {
        const mainAppUrl = getServerToServerBaseURL();
        if (!mainAppUrl) return;
        
        const logoUrl = `${mainAppUrl}/favicon.ico`;
        
        // Try to load the logo
        let logo: any = null;
        try {
            const logoResponse = await fetch(logoUrl);
            if (logoResponse.ok) {
                const logoBuffer = await logoResponse.arrayBuffer();
                logo = await loadImage(Buffer.from(logoBuffer));
            }
        } catch (error) {
            console.warn('Failed to load logo for blur overlay:', error);
        }
        
        // Adaptive text sizing based on image dimensions
        // Use a percentage of the smaller dimension for better scaling
        const minDimension = Math.min(width, height);
        const maxDimension = Math.max(width, height);
        
        // Calculate base font size - scales with image size
        // For small images (< 400px): use 5% of min dimension
        // For medium images (400-1200px): use 4% of min dimension
        // For large images (> 1200px): use 3% of min dimension
        let baseFontSize: number;
        if (minDimension < 400) {
            baseFontSize = minDimension * 0.05;
        } else if (minDimension < 1200) {
            baseFontSize = minDimension * 0.04;
        } else {
            baseFontSize = minDimension * 0.03;
        }
        
        // Ensure minimum and maximum font sizes
        const fontSize = Math.max(20, Math.min(Math.floor(baseFontSize), 72));
        
        // Set up text styling
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const text = 'Login Required';
        const textMetrics = ctx.measureText(text);
        const textWidth = textMetrics.width;
        const textHeight = fontSize;
        
        // Adaptive logo sizing - scales proportionally with image dimensions
        // Use a more sophisticated calculation that adapts to both width and height
        const aspectRatio = width / height;
        
        // Calculate base logo size based on image area and aspect ratio
        // For square images: use 12% of dimension
        // For wide images: scale based on height
        // For tall images: scale based on width
        let logoBaseSize: number;
        if (aspectRatio > 1.5) {
            // Wide image - base on height
            logoBaseSize = height * 0.12;
        } else if (aspectRatio < 0.67) {
            // Tall image - base on width
            logoBaseSize = width * 0.12;
        } else {
            // Square-ish image - use smaller dimension
            logoBaseSize = minDimension * 0.12;
        }
        
        // Apply adaptive scaling with min/max bounds
        // Minimum: 40px for very small images
        // Maximum: 180px for very large images
        // Scale smoothly between these bounds
        const logoSize = Math.max(40, Math.min(Math.floor(logoBaseSize), 180));
        
        // Adaptive padding - scales with logo size and image dimensions
        // Larger images get more padding, but keep it proportional
        const logoPadding = Math.max(15, Math.min(Math.floor(logoSize * 0.3), Math.floor(minDimension * 0.05)));
        
        // Randomly choose logo position in one of the four corners
        const cornerIndex = Math.floor(Math.random() * 4);
        // 0: top-left, 1: top-right, 2: bottom-left, 3: bottom-right
        let logoX: number;
        let logoY: number;
        
        switch (cornerIndex) {
            case 0: // top-left
                logoX = logoPadding + logoSize / 2;
                logoY = logoPadding + logoSize / 2;
                break;
            case 1: // top-right
                logoX = width - logoPadding - logoSize / 2;
                logoY = logoPadding + logoSize / 2;
                break;
            case 2: // bottom-left
                logoX = logoPadding + logoSize / 2;
                logoY = height - logoPadding - logoSize / 2;
                break;
            case 3: // bottom-right
                logoX = width - logoPadding - logoSize / 2;
                logoY = height - logoPadding - logoSize / 2;
                break;
            default:
                logoX = logoPadding + logoSize / 2;
                logoY = logoPadding + logoSize / 2;
        }
        
        // Text always centered
        const centerX = width / 2;
        const textY = height / 2;
        
        // Draw text with shadow for better visibility
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        
        // Draw text background for better readability
        const textPadding = 15;
        const textBgWidth = textWidth + textPadding * 2;
        const textBgHeight = textHeight + textPadding * 2;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(
            centerX - textBgWidth / 2,
            textY - textBgHeight / 2,
            textBgWidth,
            textBgHeight
        );
        
        // Draw text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, centerX, textY);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Draw logo if available
        if (logo) {
            try {
                // Calculate logo dimensions to maintain aspect ratio
                const logoAspectRatio = logo.width / logo.height;
                let logoDrawWidth: number;
                let logoDrawHeight: number;
                
                // Fit logo maintaining aspect ratio, using logoSize as the maximum dimension
                if (logoAspectRatio > 1) {
                    // Logo is wider than tall
                    logoDrawWidth = logoSize;
                    logoDrawHeight = logoSize / logoAspectRatio;
                } else {
                    // Logo is taller than wide or square
                    logoDrawHeight = logoSize;
                    logoDrawWidth = logoSize * logoAspectRatio;
                }
                
                // Draw subtle shadow for better visibility on blurred background
                ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                ctx.shadowBlur = 8;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
                
                // Draw logo with perfect fit maintaining aspect ratio
                const logoXPos = logoX - logoDrawWidth / 2;
                const logoYPos = logoY - logoDrawHeight / 2;
                
                ctx.drawImage(
                    logo,
                    logoXPos,
                    logoYPos,
                    logoDrawWidth,
                    logoDrawHeight
                );
                
                // Reset shadow
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            } catch (error) {
                console.warn('Failed to draw logo:', error);
            }
        }
    } catch (error) {
        console.error('Error adding login required overlay:', error);
        // Fallback: just add text without logo with adaptive sizing
        const minDimension = Math.min(width, height);
        let baseFontSize: number;
        if (minDimension < 400) {
            baseFontSize = minDimension * 0.05;
        } else if (minDimension < 1200) {
            baseFontSize = minDimension * 0.04;
        } else {
            baseFontSize = minDimension * 0.03;
        }
        const fontSize = Math.max(20, Math.min(Math.floor(baseFontSize), 72));
        
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.fillText('Login Required', width / 2, height / 2);
    }
};


