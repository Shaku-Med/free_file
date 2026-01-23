import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { platform, cpus } from 'os';
import { join, dirname } from 'path';

interface ProcessingOptions {
  outputFormat: 'hls';
  quality: 'low' | 'medium' | 'high';
}

interface ProcessingResult {
  success: boolean;
  error?: string;
  usedGPU?: boolean;
  m3u8Path?: string;
  segmentFiles?: string[];
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

function getCpuThreads(): number {
  const cpuCount = cpus().length;
  return Math.max(1, Math.floor(cpuCount * 0.5));
}

function getInputProbeSettings(): string[] {
  return ['-fflags', '+genpts+igndts', '-analyzeduration', '100M', '-probesize', '100M', '-err_detect', 'ignore_err'];
}

function getStreamMappingSettings(): string[] {
  return ['-map', '0:v:0', '-map', '0:a?','-sn', '-dn'];
}

function getVideoFilterSettings(): string[] {
  return ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p'];
}

async function processVideoWithFFmpeg(
  inputPath: string,
  outputPath: string,
  options: ProcessingOptions,
  useGPU: boolean = true
): Promise<ProcessingResult> {
  const outputDir = dirname(outputPath);
  const timestamp = Date.now();
  
  return new Promise((resolve) => {
    const config = getEncodingConfig(useGPU);
    const qualitySettings = getQualitySettings(options.quality);
    const cpuThreads = getCpuThreads();

    const args = [
      ...config.hwaccel,
      ...getInputProbeSettings(),
      '-i', inputPath,
      ...getStreamMappingSettings(),
      '-threads', cpuThreads.toString(),
      '-c:v', config.encoder,
      '-preset', useGPU ? 'p1' : 'fast',
      '-tune', useGPU ? 'zerolatency' : 'fastdecode',
      ...getVideoFilterSettings(),
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-ar', '48000',
      ...qualitySettings,
      '-max_muxing_queue_size', '2048'
    ];

    if (options.outputFormat === 'hls') {
      const segmentPattern = join(outputDir, `segment_${timestamp}_%03d.ts`);
      args.push(
        '-hls_time', '10',
        '-hls_list_size', '0',
        '-hls_segment_filename', segmentPattern,
        '-hls_flags', 'independent_segments',
        '-hls_allow_cache', '0',
        '-hls_start_number_source', '0',
        '-f', 'hls'
      );
    }

    args.push('-y', outputPath);

    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false
    });
    
    if (process.platform === 'win32') {
      try {
        const { exec } = require('child_process');
        exec(`wmic process where processid=${ffmpeg.pid} CALL setpriority "below normal"`, () => {});
      } catch {}
    } else {
      try {
        ffmpeg.unref();
      } catch {}
    }

    let stderr = '';
    let stdout = '';

    ffmpeg.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', async (code) => {
      if (code === 0 && existsSync(outputPath)) {
        const files = await readdir(outputDir);
        const segmentFiles = files
          .filter((f: string) => f.startsWith(`segment_${timestamp}_`) && f.endsWith('.ts'))
          .map((f: string) => join(outputDir, f));

        resolve({
          success: true,
          usedGPU: useGPU,
          m3u8Path: outputPath,
          segmentFiles
        });
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
        console.error('FFmpeg HLS processing error (CPU):', error);
        resolve({ success: false, error: 'Video processing failed', usedGPU: false });
      }
    });
  });
}

export async function processVideoToHLS(
  inputPath: string,
  outputPath: string,
  quality: 'low' | 'medium' | 'high' = 'medium'
): Promise<ProcessingResult> {
  const hasGPU = await checkGPUAvailability();

  if (hasGPU) {
    const gpuResult = await processVideoWithFFmpeg(inputPath, outputPath, { outputFormat: 'hls', quality }, true);
    if (gpuResult.success) {
      return gpuResult;
    }
    const cpuResult = await processVideoWithFFmpeg(inputPath, outputPath, { outputFormat: 'hls', quality }, false);
    if (cpuResult.success) {
      return cpuResult;
    }
    return {
      success: false,
      error: `GPU attempt failed: ${gpuResult.error || 'Unknown error'}. CPU attempt failed: ${cpuResult.error || 'Unknown error'}`,
      usedGPU: false
    };
  }

  return await processVideoWithFFmpeg(inputPath, outputPath, { outputFormat: 'hls', quality }, false);
}
