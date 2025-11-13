
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
      const frameCount = 10; // Number of frames to check for NSFW
      const interval = videoDuration / (frameCount + 1);

      options.onProgress?.(5, `Preparing to generate ${frameCount} thumbnails...`);

      // Generate all thumbnails in parallel (much faster than sequential!)
      const thumbnailPromises: Promise<{ index: number; blob: Blob } | null>[] = [];
      
      for (let i = 1; i <= frameCount; i++) {
        const timeOffset = interval * i;
        
        thumbnailPromises.push(
          this.captureFrameFromVideo(videoFile, timeOffset, options)
            .then(blob => blob ? { index: i, blob } : null)
            .catch(() => null)
        );
      }

      // Wait for all thumbnails to be generated in parallel
      const thumbnailResults = await Promise.all(thumbnailPromises);
      const validThumbnails = thumbnailResults.filter(
        (result): result is { index: number; blob: Blob } => result !== null
      );

      const generationProgress = Math.round(5 + (validThumbnails.length / frameCount) * 40);
      options.onProgress?.(generationProgress, `Generated ${validThumbnails.length}/${frameCount} thumbnails`);

      // Check NSFW one by one using server-side API (sending single file at a time)
      const nsfwResults: boolean[] = [];
      
      for (let i = 0; i < validThumbnails.length; i++) {
        const result = validThumbnails[i];
        try {
          // Update progress
          const checkProgress = Math.round(45 + ((i + 1) / validThumbnails.length) * 40);
          options.onProgress?.(checkProgress, `Checking frame ${i + 1}/${validThumbnails.length} for adult content...`);
          
          // Send single frame to server-side API
          const isNSFW = await this.checkNSFWViaAPI(result.blob);
          nsfwResults.push(isNSFW);
        } catch (error) {
          // If check fails, assume not NSFW to avoid false positives
          nsfwResults.push(false);
        }
      }
      
      // Check if any thumbnail was NSFW
      const hasNSFW = nsfwResults.some(result => result === true);

      options.onProgress?.(90, `Generating final thumbnail...`);

      // Generate final thumbnail from random time offset
      const randomTimeOffset = Math.random() * videoDuration;
      const finalThumbnailBlob = await this.captureFrameFromVideo(videoFile, randomTimeOffset, options);

      if (!finalThumbnailBlob) {
        throw new Error('Failed to generate final thumbnail');
      }

      options.onProgress?.(100, 'Thumbnail generation complete');

      return {
        success: true,
        thumbnailBlob: finalThumbnailBlob,
        nsfw: hasNSFW
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        nsfw: false
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

  /**
   * Check NSFW content via server-side API
   * Sends a single image blob to the API endpoint
   */
  private async checkNSFWViaAPI(imageBlob: Blob): Promise<boolean> {
    try {
      const formData = new FormData();
      // Convert blob to File for FormData
      const imageFile = new File([imageBlob], 'frame.jpg', { type: 'image/jpeg' });
      formData.append('image', imageFile);

      const response = await fetch(`/api/nsfw/detect/${Math.random().toString(36).substring(2, 15)}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success !== undefined) {
        return result.nsfw === true;
      }
      
      return false;
    } catch (error) {
      console.error('NSFW API check error:', error);
      return false; // Return false on error to avoid blocking uploads
    }
  }

  async checkImageNSFW(
    imageFile: File, 
    onProgress?: (progress: number, message: string) => void
  ): Promise<{ success: boolean; nsfw: boolean; error?: string }> {
    try {
      onProgress?.(50, 'Checking image for adult content...');
      
      // Convert File to Blob for API call
      const imageBlob = new Blob([imageFile], { type: imageFile.type });
      const isNSFW = await this.checkNSFWViaAPI(imageBlob);
      
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
    // Cleanup video element if it exists
    if (this.videoElement) {
      this.videoElement.src = '';
      this.videoElement.load();
      this.videoElement = null;
    }
  }
}
