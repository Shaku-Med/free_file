import { useEffect, useRef } from 'react';

interface UseWatchTrackingOptions {
  fileId: string;
  userId?: string | null;
  isVideo?: boolean;
  videoElement?: HTMLVideoElement | null;
  source?: string;
}

/**
 * Hook to track watch time and watch percentage
 */
export const useWatchTracking = ({
  fileId,
  userId,
  isVideo = false,
  videoElement,
  source = 'page_view',
}: UseWatchTrackingOptions) => {
  const watchStartTimeRef = useRef<number | null>(null);
  const totalWatchTimeRef = useRef<number>(0);
  const lastUpdateTimeRef = useRef<number>(0);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const videoDurationRef = useRef<number>(0);

  // Track video watch time and percentage
  useEffect(() => {
    if (!isVideo || !fileId) return;
    
    // Get video element - either from prop or find in DOM
    let video: HTMLVideoElement | null = videoElement || null;
    
    if (!video) {
      // Try to find video element in DOM
      video = document.querySelector('video') as HTMLVideoElement;
    }
    
    if (!video) return;
    let isPlaying = false;
    let lastCurrentTime = 0;

    const handlePlay = () => {
      isPlaying = true;
      watchStartTimeRef.current = Date.now();
    };

    const handlePause = () => {
      isPlaying = false;
      if (watchStartTimeRef.current) {
        const watchDuration = (Date.now() - watchStartTimeRef.current) / 1000;
        totalWatchTimeRef.current += watchDuration;
        watchStartTimeRef.current = null;
      }
    };

    const handleTimeUpdate = () => {
      if (video.duration) {
        videoDurationRef.current = video.duration;
      }
    };

    const handleEnded = () => {
      isPlaying = false;
      if (watchStartTimeRef.current) {
        const watchDuration = (Date.now() - watchStartTimeRef.current) / 1000;
        totalWatchTimeRef.current += watchDuration;
        watchStartTimeRef.current = null;
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, [isVideo, videoElement, fileId, userId, source]);

  // Track image view time (for images, track how long they're viewed)
  useEffect(() => {
    if (isVideo || !fileId) return;

    let viewStartTime: number | null = null;
    let totalViewTime = 0;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page hidden - pause tracking
        if (viewStartTime) {
          totalViewTime += (Date.now() - viewStartTime) / 1000;
          viewStartTime = null;
        }
      } else {
        // Page visible - resume tracking
        viewStartTime = Date.now();
      }
    };

    const handleUnload = () => {
      if (viewStartTime) {
        totalViewTime += (Date.now() - viewStartTime) / 1000;
      }
    };

    // Start tracking when component mounts
    viewStartTime = Date.now();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [isVideo, fileId, userId, source]);
};
