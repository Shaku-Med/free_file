import { spawn } from 'child_process';
import { writeFile, unlink, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface ThumbnailResult {
  success: boolean;
  thumbnails?: { buffer: Buffer; timeOffset: number }[];
  error?: string;
}

export class VideoThumbnailService {
  async extractThumbnails(
    videoBuffer: Buffer,
    count: number = 10
  ): Promise<ThumbnailResult> {
    const tempDir = join(process.cwd(), 'temp');
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    const tempVideoPath = join(tempDir, `video_${randomUUID()}.mp4`);
    
    try {
      await writeFile(tempVideoPath, videoBuffer);

      const metadata = await this.getVideoMetadata(tempVideoPath);
      if (!metadata) {
        await unlink(tempVideoPath).catch(() => {});
        return { success: false, error: 'Failed to get video metadata' };
      }

      const duration = metadata.duration;
      if (duration <= 0) {
        await unlink(tempVideoPath).catch(() => {});
        return { success: false, error: 'Invalid video duration' };
      }

      const interval = duration / (count + 1);
      const thumbnails: { buffer: Buffer; timeOffset: number }[] = [];

      for (let i = 1; i <= count; i++) {
        const timeOffset = interval * i;
        const thumbnailPath = join(tempDir, `thumb_${randomUUID()}.jpg`);
        
        const success = await this.extractFrame(tempVideoPath, thumbnailPath, timeOffset);
        
        if (success) {
          const thumbnailBuffer = await readFile(thumbnailPath);
          thumbnails.push({
            buffer: thumbnailBuffer,
            timeOffset: Math.round(timeOffset)
          });
          await unlink(thumbnailPath).catch(() => {});
        }
      }

      await unlink(tempVideoPath).catch(() => {});

      if (thumbnails.length === 0) {
        return { success: false, error: 'Failed to extract any thumbnails' };
      }

      return {
        success: true,
        thumbnails
      };
    } catch (error) {
      await unlink(tempVideoPath).catch(() => {});
      console.error('Video thumbnail extraction error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async getVideoMetadata(videoPath: string): Promise<{ duration: number } | null> {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-i', videoPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', () => {
        const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);
        if (durationMatch) {
          const hours = parseInt(durationMatch[1]);
          const minutes = parseInt(durationMatch[2]);
          const seconds = parseFloat(durationMatch[3]);
          const duration = hours * 3600 + minutes * 60 + seconds;
          resolve({ duration });
        } else {
          resolve(null);
        }
      });

      ffmpeg.on('error', () => {
        resolve(null);
      });
    });
  }

  private async extractFrame(
    videoPath: string,
    outputPath: string,
    timeOffset: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-ss', timeOffset.toString(),
        '-vframes', '1',
        '-vf', 'scale=320:-1',
        '-q:v', '2',
        '-y',
        outputPath
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      ffmpeg.on('close', (code) => {
        resolve(code === 0 && existsSync(outputPath));
      });

      ffmpeg.on('error', () => {
        resolve(false);
      });
    });
  }
}
