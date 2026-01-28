
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
}

export class ThumbnailGenerator {
  private videoElement: HTMLVideoElement | null = null;

  constructor() {
    // No initialization needed - using native browser APIs
  }

  /**
   * Generate thumbnail from video using HTML5 Video + Canvas (much faster than FFmpeg)
   * Compatible with Safari mobile (iOS) - uses playsInline and muted attributes
   */
  private async captureFrameFromVideo(
    videoFile: File,
    timeOffset: number,
    options: ThumbnailOptions
  ): Promise<Blob | null> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true; // Required for autoplay/seek on iOS
      video.playsInline = true; // Required for iOS Safari
      video.setAttribute('webkit-playsinline', 'true'); // Legacy iOS support
      video.crossOrigin = 'anonymous'; // Better compatibility
      
      const videoUrl = URL.createObjectURL(videoFile);
      video.src = videoUrl;

      let timeoutId: NodeJS.Timeout | null = null;
      let hasResolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        video.src = '';
        video.load();
        URL.revokeObjectURL(videoUrl);
      };

      const resolveOnce = (value: Blob | null) => {
        if (!hasResolved) {
          hasResolved = true;
          cleanup();
          resolve(value);
        }
      };

      const onError = (e?: Event) => {
        resolveOnce(null);
      };

      const onLoadedMetadata = () => {
        // Clamp timeOffset to valid range
        const clampedTime = Math.max(0, Math.min(timeOffset, video.duration || 0));
        
        // For Safari iOS, we might need to wait a bit before seeking
        if (video.readyState >= 2) {
          video.currentTime = clampedTime;
        } else {
          // Wait for more data to load
          video.addEventListener('loadeddata', onLoadedData, { once: true });
          video.load();
        }
      };

      const onLoadedData = () => {
        const clampedTime = Math.max(0, Math.min(timeOffset, video.duration || 0));
        video.currentTime = clampedTime;
      };

      const onCanPlay = () => {
        // Fallback: if seeked doesn't fire, try capturing anyway
        if (video.readyState >= 2) {
          const clampedTime = Math.max(0, Math.min(timeOffset, video.duration || 0));
          if (Math.abs(video.currentTime - clampedTime) < 0.5) {
            captureFrame();
          }
        }
      };

      const captureFrame = () => {
        try {
          // Ensure video dimensions are available (Safari iOS sometimes needs a moment)
          let videoWidth = video.videoWidth;
          let videoHeight = video.videoHeight;
          
          // If dimensions aren't available, wait a bit (Safari iOS quirk)
          if ((videoWidth === 0 || videoHeight === 0) && video.readyState >= 2) {
            // Try to get dimensions from naturalWidth/Height as fallback
            videoWidth = (video as any).naturalWidth || videoWidth || 1920;
            videoHeight = (video as any).naturalHeight || videoHeight || 1080;
          }

          const canvas = document.createElement('canvas');
          const {
            width = 1920,
            height = 1080,
            maintainAspectRatio = true,
            maxWidth,
            maxHeight
          } = options;

          // Use fallback dimensions if video dimensions aren't available
          if (videoWidth === 0 || videoHeight === 0) {
            videoWidth = width;
            videoHeight = height;
          }
          
          // Calculate canvas dimensions
          let canvasWidth = videoWidth;
          let canvasHeight = videoHeight;

          if (maintainAspectRatio) {
            const aspectRatio = videoWidth / videoHeight;
            
            if (maxWidth && maxHeight) {
              // Fit within max dimensions while maintaining aspect ratio
              if (videoWidth > maxWidth || videoHeight > maxHeight) {
                const widthRatio = maxWidth / videoWidth;
                const heightRatio = maxHeight / videoHeight;
                const ratio = Math.min(widthRatio, heightRatio);
                canvasWidth = Math.floor(videoWidth * ratio);
                canvasHeight = Math.floor(videoHeight * ratio);
              }
            } else if (width && height) {
              // Fit within specified dimensions
              const widthRatio = width / videoWidth;
              const heightRatio = height / videoHeight;
              const ratio = Math.min(widthRatio, heightRatio);
              canvasWidth = Math.floor(videoWidth * ratio);
              canvasHeight = Math.floor(videoHeight * ratio);
            } else if (width) {
              canvasWidth = Math.min(width, videoWidth);
              canvasHeight = Math.floor(canvasWidth / aspectRatio);
            } else if (height) {
              canvasHeight = Math.min(height, videoHeight);
              canvasWidth = Math.floor(canvasHeight * aspectRatio);
            } else {
              // Use maxWidth/maxHeight if provided, otherwise use video dimensions
              if (maxWidth) {
                canvasWidth = Math.min(maxWidth, videoWidth);
                canvasHeight = Math.floor(canvasWidth / aspectRatio);
              } else if (maxHeight) {
                canvasHeight = Math.min(maxHeight, videoHeight);
                canvasWidth = Math.floor(canvasHeight * aspectRatio);
              }
            }
          } else {
            // Don't maintain aspect ratio
            canvasWidth = width || videoWidth;
            canvasHeight = height || videoHeight;
          }

          canvas.width = canvasWidth;
          canvas.height = canvasHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolveOnce(null);
            return;
          }

          // Draw video frame to canvas
          // Safari iOS sometimes needs the video to be "played" (even if muted) to capture frames
          // But we can draw without actually playing by using currentTime
          ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);

          // Convert canvas to blob
          canvas.toBlob(
            (blob) => {
              resolveOnce(blob);
            },
            'image/jpeg',
            0.92 // Quality
          );
        } catch (error) {
          resolveOnce(null);
        }
      };

      const onSeeked = () => {
        // Small delay to ensure frame is ready (Safari iOS sometimes needs this)
        setTimeout(() => {
          captureFrame();
        }, 50);
      };

      video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('canplay', onCanPlay, { once: true });
      video.addEventListener('error', onError, { once: true });

      // Set a timeout to prevent hanging (longer for Safari iOS which can be slower)
      timeoutId = setTimeout(() => {
        if (!hasResolved) {
          resolveOnce(null);
        }
      }, 15000); // 15 second timeout for Safari mobile
    });
  }

  async generateThumbnail(
    videoFile: File, 
    options: ThumbnailOptions = {}
  ): Promise<ThumbnailResult> {
    try {
      const videoDuration = await this.getVideoDuration(videoFile);
      const randomTimeOffset = Math.random() * videoDuration;
      const finalThumbnailBlob = await this.captureFrameFromVideo(videoFile, randomTimeOffset, options);

      if (!finalThumbnailBlob) {
        throw new Error('Failed to generate final thumbnail');
      }

      options.onProgress?.(100, 'Thumbnail generation complete');

      return {
        success: true,
        thumbnailBlob: finalThumbnailBlob
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async getVideoDuration(videoFile: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true; // Required for Safari iOS
      video.playsInline = true; // Required for Safari iOS
      video.setAttribute('webkit-playsinline', 'true'); // Legacy iOS support
      
      const videoUrl = URL.createObjectURL(videoFile);
      video.src = videoUrl;
      
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('error', onError);
        video.src = '';
        video.load();
        URL.revokeObjectURL(videoUrl);
      };
      
      const onLoadedMetadata = () => {
        const duration = video.duration;
        cleanup();
        resolve(duration);
      };
      
      const onError = () => {
        cleanup();
        reject(new Error('Failed to load video metadata'));
      };
      
      video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
      video.addEventListener('error', onError, { once: true });
      
      // Timeout for Safari iOS
      setTimeout(() => {
        if (video.readyState < 2) {
          cleanup();
          reject(new Error('Timeout loading video metadata'));
        }
      }, 10000);
    });
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

  async generateMultipleThumbnails(
    videoFile: File,
    count: number = 3,
    options: ThumbnailOptions = {}
  ): Promise<ThumbnailResult[]> {
    try {
      const results: ThumbnailResult[] = [];
      const videoDuration = await this.getVideoDuration(videoFile);
      const interval = videoDuration / (count + 1);

      // Generate all thumbnails in parallel
      const thumbnailPromises: Promise<ThumbnailResult>[] = [];
      
      for (let i = 1; i <= count; i++) {
        const timeOffset = interval * i;
        thumbnailPromises.push(
          this.captureFrameFromVideo(videoFile, timeOffset, options)
            .then(blob => ({
              success: !!blob,
              thumbnailBlob: blob || undefined,
              error: blob ? undefined : 'Failed to generate thumbnail'
            }))
            .catch(error => ({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            }))
        );
      }

      return await Promise.all(thumbnailPromises);
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
      const blob = await this.captureFrameFromVideo(videoFile, timeOffset, options);
      if (blob) {
        return {
          success: true,
          thumbnailBlob: blob
        };
      }
    }
    
    return {
      success: false,
      error: 'Failed to generate thumbnail with all fallback time offsets'
    };
  }

  async destroy(): Promise<void> {
    // Cleanup video element if it exists
    if (this.videoElement) {
      this.videoElement.src = '';
      this.videoElement.load();
      this.videoElement = null;
    }
  }
}
