import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import { join } from 'path';

interface ProcessingOptions {
    outputFormat: 'mp4' | 'hls';
    quality: 'low' | 'medium' | 'high';
}

interface ProcessingResult {
    success: boolean;
    error?: string;
    usedGPU?: boolean;
}

let gpuAvailable: boolean | null = null;

async function checkGPUAvailability(): Promise<boolean> {
    if (gpuAvailable !== null) {
        return gpuAvailable;
    }

    return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-hwaccels'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        ffmpeg.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', () => {
            const output = stdout + stderr;
            const hasCuda = output.includes('cuda');
            const hasD3d11va = output.includes('d3d11va');
            const hasQsv = output.includes('qsv');
            
            gpuAvailable = hasCuda || hasD3d11va || hasQsv;
            resolve(gpuAvailable);
        });

        ffmpeg.on('error', () => {
            gpuAvailable = false;
            resolve(false);
        });
    });
}

function getEncodingConfig(useGPU: boolean): { hwaccel: string[]; encoder: string; fallbackEncoder: string } {
    const osPlatform = platform();

    if (useGPU && osPlatform === 'win32') {
        return {
            hwaccel: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
            encoder: 'h264_nvenc',
            fallbackEncoder: 'libx264'
        };
    }

    if (useGPU && osPlatform === 'linux') {
        return {
            hwaccel: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
            encoder: 'h264_nvenc',
            fallbackEncoder: 'libx264'
        };
    }

    return {
        hwaccel: [],
        encoder: 'libx264',
        fallbackEncoder: 'libx264'
    };
}

function getQualitySettings(quality: 'low' | 'medium' | 'high' = 'medium') {
    switch (quality) {
        case 'high':
            return ['-b:v', '5000k', '-maxrate', '5000k', '-bufsize', '10000k'];
        case 'medium':
            return ['-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k'];
        case 'low':
        default:
            return ['-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k'];
    }
}

async function processVideoWithFFmpeg(
    inputPath: string,
    outputPath: string,
    options: ProcessingOptions,
    useGPU: boolean = true
): Promise<ProcessingResult> {
    const { dirname } = await import('path')
    const outputDir = dirname(outputPath)
    const timestamp = Date.now()
    
    return new Promise((resolve) => {
        const config = getEncodingConfig(useGPU);
        const qualitySettings = getQualitySettings(options.quality);

        const args = [
            ...config.hwaccel,
            '-i', inputPath,
            '-c:v', config.encoder,
            '-preset', useGPU ? 'fast' : 'medium',
            '-c:a', 'aac',
            '-b:a', '128k',
            ...qualitySettings
        ];

        if (options.outputFormat === 'hls') {
            const segmentPattern = join(outputDir, `segment_${timestamp}_%03d.ts`)
            args.push(
                '-hls_time', '10',
                '-hls_list_size', '0',
                '-hls_segment_filename', segmentPattern,
                '-hls_flags', 'independent_segments',
                '-hls_allow_cache', '0',
                '-hls_start_number_source', '0',
                '-f', 'hls'
            )
        }

        args.push('-y', outputPath);

        const ffmpeg = spawn('ffmpeg', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        let stdout = '';

        ffmpeg.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0 && existsSync(outputPath)) {
                resolve({ success: true, usedGPU: useGPU });
            } else {
                const errorMsg = stderr || stdout || 'Unknown error';
                const isGPUError = errorMsg.includes('nvenc') || 
                                 errorMsg.includes('cuda') || 
                                 errorMsg.includes('hardware') ||
                                 errorMsg.includes('not found');

                if (useGPU && isGPUError) {
                    resolve({ success: false, error: 'GPU_ERROR', usedGPU: false });
                } else {
                    resolve({ success: false, error: errorMsg, usedGPU: useGPU });
                }
            }
        });

        ffmpeg.on('error', (error) => {
            if (useGPU) {
                resolve({ success: false, error: 'GPU_ERROR', usedGPU: false });
            } else {
                resolve({ success: false, error: error.message, usedGPU: false });
            }
        });
    });
}

export async function processVideo(
    inputPath: string,
    outputPath: string,
    options: ProcessingOptions
): Promise<ProcessingResult> {
    const hasGPU = await checkGPUAvailability();

    if (hasGPU) {
        const result = await processVideoWithFFmpeg(inputPath, outputPath, options, true);
        
        if (result.success) {
            return result;
        }

        if (result.error === 'GPU_ERROR') {
            return await processVideoWithFFmpeg(inputPath, outputPath, options, false);
        }

        return result;
    }

    return await processVideoWithFFmpeg(inputPath, outputPath, options, false);
}

