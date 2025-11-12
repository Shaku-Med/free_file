import { CheckNSFW } from '../../../lib/utils';

declare global {
  interface Window {
    FFmpeg?: any;
  }
}

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  timeOffset?: number;
  maintainAspectRatio?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  onProgress?: (progress: number, message: string) => void;
}

export interface ThumbnailResult {
  success: boolean;
  thumbnailBlob?: Blob;
  error?: string;
  nsfw?: boolean;
}

export class ThumbnailGenerator {
  private ffmpeg: any;
  private isLoaded: boolean = false;

  constructor() {
    this.loadFFmpeg();
  }

  private async loadFFmpeg(): Promise<void> {
    if (this.isLoaded && this.ffmpeg) return;

    try {
      if (!window.FFmpeg) {
        throw new Error('FFmpeg not available on window object');
      }

      if (this.ffmpeg) {
        try {
          this.ffmpeg.exit();
        } catch (error) {
          // Silent cleanup
        }
      }

      this.ffmpeg = window.FFmpeg.createFFmpeg({ log: true });
      await this.ffmpeg.load();
      this.isLoaded = true;
    } catch (error) {
      throw new Error('FFmpeg initialization failed');
    }
  }

  async generateThumbnail(
    videoFile: File, 
    options: ThumbnailOptions = {}
  ): Promise<ThumbnailResult> {
    try {
      await this.loadFFmpeg();

      const videoDuration = await this.getVideoDuration(videoFile);
      const frameCount = 10; // Number of frames to check for NSFW
      const interval = videoDuration / (frameCount + 1);
      const nsfwResults: boolean[] = [];
      const inputFileName = `input_${Date.now()}.${this.getFileExtension(videoFile.name)}`;

      // Write video file once
      const videoData = await this.fileToUint8Array(videoFile);
      await this.ffmpeg.FS("writeFile", inputFileName, videoData);

      const {
        width = 1920,
        height = 1080,
        maintainAspectRatio = true,
        maxWidth,
        maxHeight
      } = options;

      let scaleFilter: string;
      if (maintainAspectRatio) {
        if (maxWidth && maxHeight) {
          scaleFilter = `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease`;
        } else if (width && height) {
          scaleFilter = `scale='min(${width},iw)':'min(${height},ih)':force_original_aspect_ratio=decrease`;
        } else if (width) {
          scaleFilter = `scale=${width}:-1`;
        } else if (height) {
          scaleFilter = `scale=-1:${height}`;
        } else {
          scaleFilter = `scale=${width}:-1`;
        }
      } else {
        scaleFilter = `scale=${width}:${height}`;
      }

      // Generate and check thumbnails from start to end
      for (let i = 1; i <= frameCount; i++) {
        const timeOffset = interval * i;
        const outputFileName = `thumbnail_check_${i}_${Date.now()}.jpg`;
        
        // Report progress
        const progressPercent = Math.round((i / frameCount) * 100);
        options.onProgress?.(progressPercent, `Checking frame ${i}/${frameCount}...`);

        try {
          await this.ffmpeg.run(
            '-i', inputFileName,
            '-ss', timeOffset.toString(),
            '-vframes', '1',
            '-vf', scaleFilter,
            '-y',
            outputFileName
          );

          const thumbnailData = this.ffmpeg.FS("readFile", outputFileName);
          const thumbnailBlob = new Blob([thumbnailData.buffer], { type: 'image/jpeg' });
          
          // Clean up this thumbnail file immediately from FFmpeg storage
          await this.cleanupFiles([outputFileName]);
          
          // Convert blob to data URL for NSFW check
          const imageUrl = await this.blobToDataURL(thumbnailBlob);
          const isNSFW = await CheckNSFW(imageUrl);
          nsfwResults.push(isNSFW);
        } catch (error) {
          // Continue with next frame even if one fails
        }
      }

      // Check if any thumbnail was NSFW
      const hasNSFW = nsfwResults.some(result => result === true);

      // Generate final thumbnail from random time offset
      const randomTimeOffset = Math.random() * videoDuration;
      const finalOutputFileName = `thumbnail_final_${Date.now()}.jpg`;

      await this.ffmpeg.run(
        '-i', inputFileName,
        '-ss', randomTimeOffset.toString(),
        '-vframes', '1',
        '-vf', scaleFilter,
        '-y',
        finalOutputFileName
      );

      const finalThumbnailData = this.ffmpeg.FS("readFile", finalOutputFileName);
      const finalThumbnailBlob = new Blob([finalThumbnailData.buffer], { type: 'image/jpeg' });

      // Clean up all files
      await this.cleanupFiles([inputFileName, finalOutputFileName]);
      
      // Final cleanup of FFmpeg storage
      await this.cleanupFFmpeg();

      return {
        success: true,
        thumbnailBlob: finalThumbnailBlob,
        nsfw: hasNSFW
      };
    } catch (error) {
      // Ensure cleanup even on error
      await this.cleanupFFmpeg();
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        nsfw: false
      };
    }
  }

  private getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || 'mp4';
  }

  private async fileToUint8Array(file: File): Promise<Uint8Array> {
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async generateMultipleThumbnails(
    videoFile: File,
    count: number = 3,
    options: ThumbnailOptions = {}
  ): Promise<ThumbnailResult[]> {
    try {
      await this.loadFFmpeg();

      const results: ThumbnailResult[] = [];
      const videoDuration = await this.getVideoDuration(videoFile);
      const interval = videoDuration / (count + 1);

      for (let i = 1; i <= count; i++) {
        const timeOffset = interval * i;
        const result = await this.generateThumbnail(videoFile, {
          ...options,
          timeOffset
        });
        results.push(result);
      }

      return results;
    } catch (error) {
      return [{
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }];
    }
  }

  async generateThumbnailWithFallback(
    videoFile: File,
    options: ThumbnailOptions = {}
  ): Promise<ThumbnailResult> {
    const fallbackTimeOffsets = [1, 5, 10, 30];
    
    for (const timeOffset of fallbackTimeOffsets) {
      const result = await this.generateThumbnail(videoFile, {
        ...options,
        timeOffset
      });
      
      if (result.success) {
        return result;
      }
    }
    
    return {
      success: false,
      error: 'Failed to generate thumbnail with all fallback time offsets'
    };
  }

  private async getVideoDuration(videoFile: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Failed to load video metadata'));
      };
      
      video.src = URL.createObjectURL(videoFile);
    });
  }

  private async cleanupFiles(filenames: string[]): Promise<void> {
    try {
      for (const filename of filenames) {
        this.ffmpeg.FS("unlink", filename);
      }
    } catch (error) {
      // Silent cleanup
    }
  }

  private async cleanupFFmpeg(): Promise<void> {
    try {
      if (this.ffmpeg) {
        const files = this.ffmpeg.FS('readdir', '/');
        const filesToDelete = files.filter((file: any) => 
          file.startsWith('input_') || 
          file.startsWith('thumbnail_') ||
          file.startsWith('output_') ||
          file.endsWith('.jpg') ||
          file.endsWith('.mp4') ||
          file.endsWith('.ts')
        );
        
        for (const file of filesToDelete) {
          try {
            this.ffmpeg.FS("unlink", file);
          } catch (error) {
            // Silent cleanup
          }
        }
        
        this.ffmpeg.exit();
        this.ffmpeg = null;
        this.isLoaded = false;
      }
    } catch (error) {
      // Silent cleanup
    }
  }

  private async blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to convert blob to data URL'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async checkImageNSFW(imageFile: File, onProgress?: (progress: number, message: string) => void): Promise<{ success: boolean; nsfw: boolean; error?: string }> {
    try {
      onProgress?.(50, 'Checking image for adult content...');
      
      const imageUrl = await this.blobToDataURL(imageFile);
      const isNSFW = await CheckNSFW(imageUrl);
      
      onProgress?.(100, isNSFW ? 'Adult content detected' : 'Content check complete');
      
      return {
        success: true,
        nsfw: isNSFW
      };
    } catch (error) {
      return {
        success: false,
        nsfw: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async destroy(): Promise<void> {
    await this.cleanupFFmpeg();
  }
}
