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
}

export interface ThumbnailResult {
  success: boolean;
  thumbnailBlob?: Blob;
  error?: string;
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
          console.warn('Error exiting previous FFmpeg instance:', error);
        }
      }

      this.ffmpeg = window.FFmpeg.createFFmpeg({ log: true });
      await this.ffmpeg.load();
      this.isLoaded = true;
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
      throw new Error('FFmpeg initialization failed');
    }
  }

  async generateThumbnail(
    videoFile: File, 
    options: ThumbnailOptions = {}
  ): Promise<ThumbnailResult> {
    try {
      await this.loadFFmpeg();

      const {
        width = 1920,
        height = 1080,
        timeOffset = 1,
        maintainAspectRatio = true,
        maxWidth,
        maxHeight
      } = options;

      const inputFileName = `input_${Date.now()}.${this.getFileExtension(videoFile.name)}`;
      const outputFileName = `thumbnail_${Date.now()}.jpg`;

      const videoData = await this.fileToUint8Array(videoFile);
      await this.ffmpeg.FS("writeFile", inputFileName, videoData);

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

      await this.cleanupFiles([inputFileName, outputFileName]);

      return {
        success: true,
        thumbnailBlob
      };
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      await this.cleanupFFmpeg();
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
      console.error('Multiple thumbnail generation failed:', error);
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
      console.warn('Failed to cleanup files:', error);
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
            console.warn(`Failed to delete file ${file}:`, error);
          }
        }
        
        this.ffmpeg.exit();
        this.ffmpeg = null;
        this.isLoaded = false;
      }
    } catch (error) {
      console.warn('Error during FFmpeg cleanup:', error);
    }
  }

  async destroy(): Promise<void> {
    await this.cleanupFFmpeg();
  }
}
