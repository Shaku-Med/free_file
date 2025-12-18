import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad';
import type { FileType } from '~/lib/types';
import { arrangeDateForThumbnail, getRandomThumbnail, ParseFilename } from '~/lib/utils';
import { PictureInPicture2, Volume2, VolumeX } from 'lucide-react';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import Cookies from 'js-cookie';
import { driverObj } from '~/lib/Context/Context';
import { autoplayService } from '~/lib/Services/AutoplayService';
import { videoPlaybackDB } from '~/lib/Database/VideoPlaybackDB';

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
      window: Window | null;
    };
  }
}


interface CallBackProps {
  src: string
  colors: string[]
}

interface HLSPlayerProps {
  src: string;
  className?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (error: any) => void;
  onHLSReady?: (hls: Hls) => void;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  playsInline?: boolean;
  poster?: string;
  imageID?: string;
  file?: FileType | null
  callBack?: (props: CallBackProps) => void
}

const HLSPlayer: React.FC<HLSPlayerProps> = ({
  src,
  className = '',
  onPlay,
  onPause,
  onEnded,
  onError,
  onHLSReady,
  autoPlay = false,
  muted = false,
  loop = false,
  playsInline = true,
  poster = '',
  imageID = '',
  file = null,
  callBack,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState<number>(0);
  const [error, setError] = useState<boolean>(false);
  const [mediaSessionImage, setMediaSessionImage] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [showAutoplayPrompt, setShowAutoplayPrompt] = useState(false);
  const savePositionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const {
    isPipActive,
    setIsPipActive,
    pipVideoRef,
    pipHlsRef,
    supportsPip,
    toggleDocumentPip,
    isContentInPip,
    setPipContentId
  } = usePictureInPictureContext();


  const updateMediaSession = (isPlaying: boolean, currentTime: number, duration: number) => {
    if ('mediaSession' in navigator && file) {
      // Use file_title if available, otherwise parse filename (same as VideoCard)
      const title = file.file_title || ParseFilename(file.filename);

      navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: `${file?.owner?.username || 'Memories'}`,
        artwork: mediaSessionImage ? [
          { src: mediaSessionImage, sizes: '512x512', type: 'image/jpeg' }
        ] : []
      });

      navigator.mediaSession.setPositionState({
        duration: duration || 0,
        playbackRate: 1,
        position: currentTime || 0
      });

      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  };

  const setupMediaSessionHandlers = (video: HTMLVideoElement) => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
      if (isPipActive && pipVideoRef.current) {
        pipVideoRef.current.play();
      } else {
        video.play();
      }
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      if (isPipActive && pipVideoRef.current) {
        pipVideoRef.current.pause();
      } else {
        video.pause();
      }
    });

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const activeVideo = isPipActive && pipVideoRef.current ? pipVideoRef.current : video;
      activeVideo.currentTime = Math.max(activeVideo.currentTime - (details.seekOffset || 10), 0);
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const activeVideo = isPipActive && pipVideoRef.current ? pipVideoRef.current : video;
      activeVideo.currentTime = Math.min(activeVideo.currentTime + (details.seekOffset || 10), activeVideo.duration);
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== null && details.seekTime !== undefined) {
        const activeVideo = isPipActive && pipVideoRef.current ? pipVideoRef.current : video;
        activeVideo.currentTime = details.seekTime;
      }
    });

    navigator.mediaSession.setActionHandler('stop', () => {
      const activeVideo = isPipActive && pipVideoRef.current ? pipVideoRef.current : video;
      activeVideo.pause();
      activeVideo.currentTime = 0;
    });
  };


  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const initializeHLS = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        // Load saved playback position from IndexedDB
        if (imageID) {
          try {
            const savedPosition = await videoPlaybackDB.getPosition(imageID);
            if (savedPosition && savedPosition.currentTime > 0) {
              // Restore position after metadata loads
              const restorePosition = () => {
                if (video.duration > 0) {
                  // Only restore if position is valid and not at the very end (>95%)
                  const isNearEnd = savedPosition.duration > 0 && 
                    (savedPosition.currentTime / savedPosition.duration) > 0.95;
                  
                  if (!isNearEnd && savedPosition.currentTime < video.duration) {
                    video.currentTime = Math.min(savedPosition.currentTime, video.duration - 1);
                  }
                }
              };

              // Try to restore immediately if duration is already available
              if (video.readyState >= 1 && video.duration > 0) {
                restorePosition();
              } else {
                // Wait for metadata
                video.addEventListener('loadedmetadata', restorePosition, { once: true });
              }
            }
          } catch (error) {
            console.error('Failed to load saved playback position:', error);
          }
        }

        const isHLSStream = src.includes('.m3u8') || src.includes('application/vnd.apple.mpegurl');

        if (isHLSStream && Hls.isSupported()) {
          if (hlsRef.current) {
            hlsRef.current.destroy();
          }

          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 5,
            liveDurationInfinity: false,
            highBufferWatchdogPeriod: 2,
            nudgeOffset: 0.1,
            nudgeMaxRetry: 3,
            maxFragLookUpTolerance: 0.25,
            liveBackBufferLength: 0,
            maxBufferHole: 0.5,
            forceKeyFrameOnDiscontinuity: true,
            abrEwmaFastLive: 3.0,
            abrEwmaSlowLive: 9.0,
            abrEwmaFastVoD: 3.0,
            abrEwmaSlowVoD: 9.0,
            abrEwmaDefaultEstimate: 500000,
            abrBandWidthFactor: 0.95,
            abrBandWidthUpFactor: 0.7,
            abrMaxWithRealBitrate: false,
            maxStarvationDelay: 4,
            maxLoadingDelay: 4,
            minAutoBitrate: 0,
            emeEnabled: false,
            fragLoadingTimeOut: 20000,
            manifestLoadingTimeOut: 10000,
            levelLoadingTimeOut: 10000,
            fragLoadingMaxRetry: 6,
            manifestLoadingMaxRetry: 4,
            levelLoadingMaxRetry: 4,
            startLevel: -1,
            capLevelToPlayerSize: true,
            testBandwidth: false
          });

          // Ensure cookies are sent with media segment requests
          // for routes that require authentication via cookies.
          // Works with the default XHR loader.
          // If Fetch loader is used in the future, switch to fetchSetup with credentials: 'include'.
          (hls as any).config.xhrSetup = (xhr: XMLHttpRequest) => {
            try {
              xhr.withCredentials = true;
            } catch {}
          };

          hlsRef.current = hls;
          hls.loadSource(src);
          hls.attachMedia(video);

          if (onHLSReady) {
            onHLSReady(hls);
          }

          hls.on(Hls.Events.ERROR, (event: any, data: any) => {
            console.error('HLS Error:', data);

            if (data.type === 'mediaError' && data.details === 'fragParsingError') {
              console.warn('Fragment parsing error detected, attempting recovery...');
              if (data.frag && data.frag.loader) {
                data.frag.loader.abort();
              }
              hls.startLoad();
              return;
            }

            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.error('Fatal network error encountered, trying to recover...');
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.error('Fatal media error encountered, trying to recover...');
                  hls.recoverMediaError();
                  break;
                default:
                  setHasError(true);
                  setIsLoading(false);
                  if (onError) {
                    onError(data);
                  }
                  break;
              }
            }
          });
        } else if (isHLSStream) {
          console.warn('HLS is not supported in this browser');
          setHasError(true);
          setIsLoading(false);
        } else {
          video.src = src;
          video.load();
          setIsLoading(false);
        }

        setupMediaSessionHandlers(video);
      } catch (error) {
        console.error('Error initializing HLS:', error);
        setHasError(true);
        setIsLoading(false);
        if (onError) {
          onError(error);
        }
      }
    };

    initializeHLS();

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !autoPlay) return;

    const playVideo = async () => {
      if (isPipActive && !isContentInPip(imageID)) {
        return;
      }

      // Use autoplay service to attempt play with sound
      if (autoplayService.isAutoplayEnabled()) {
        const success = await autoplayService.attemptAutoplayWithSound(video);
        if (!success && !video.muted) {
          // Autoplay with sound was blocked
          setAutoplayBlocked(true);
          setShowAutoplayPrompt(true);
        } else if (success) {
          setAutoplayBlocked(false);
          setShowAutoplayPrompt(false);
        }
      } else {
        // Autoplay not enabled, try normal play
        try {
          await video.play();
        } catch (error: any) {
          if (error.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
            setShowAutoplayPrompt(true);
          }
        }
      }
    };

    if (video.readyState >= 2) {
      playVideo();
    } else {
      video.addEventListener('canplay', playVideo, { once: true });
    }

    return () => {
      video.removeEventListener('canplay', playVideo);
    };
  }, [autoPlay, isPipActive, isContentInPip, imageID]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPipActive && !isContentInPip(imageID) && !video.paused) {
      video.pause();
    }
  }, [isPipActive, isContentInPip, imageID]);

  // Intersection Observer - detect when video enters viewport (used by YouTube/Pornhub)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !autoPlay) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            // Video is in viewport, attempt autoplay
            if (autoplayService.isAutoplayEnabled() && video.paused) {
              autoplayService.attemptAutoplayWithSound(video).then((success) => {
                if (!success && !video.muted) {
                  setAutoplayBlocked(true);
                  setShowAutoplayPrompt(true);
                }
              });
            }
          }
        });
      },
      {
        threshold: [0.5], // Trigger when 50% visible
        rootMargin: '0px',
      }
    );

    observer.observe(video);

    return () => {
      observer.disconnect();
    };
  }, [autoPlay, imageID]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    /**
     * Save playback position to IndexedDB
     * Uses debouncing to avoid too frequent writes
     */
    const savePlaybackPosition = () => {
      if (!imageID || !video.duration || isNaN(video.currentTime)) return;

      // Clear existing timeout
      if (savePositionTimeoutRef.current) {
        clearTimeout(savePositionTimeoutRef.current);
      }

      // Debounce: save after 2 seconds of no updates
      savePositionTimeoutRef.current = setTimeout(async () => {
        try {
          await videoPlaybackDB.savePosition(
            imageID,
            video.currentTime,
            video.duration,
            src
          );
        } catch (error) {
          console.error('Failed to save playback position:', error);
        }
      }, 2000); // Save 2 seconds after last update
    };

    /**
     * Save immediately (for pause/end events)
     */
    const savePlaybackPositionImmediate = async () => {
      if (!imageID || !video.duration || isNaN(video.currentTime)) return;

      // Clear debounced save
      if (savePositionTimeoutRef.current) {
        clearTimeout(savePositionTimeoutRef.current);
        savePositionTimeoutRef.current = null;
      }

      try {
        await videoPlaybackDB.savePosition(
          imageID,
          video.currentTime,
          video.duration,
          src
        );
      } catch (error) {
        console.error('Failed to save playback position:', error);
      }
    };

    const handlePlay = () => {
      if (isPipActive && !isContentInPip(imageID)) {
        video.pause();
        return;
      }
      
      setIsLoading(false);
      savePlaybackPosition();
      if (!isPipActive) {
        updateMediaSession(true, video.currentTime, video.duration);
      }
      if (onPlay) onPlay();
    };

    const handlePause = async () => {
      await savePlaybackPositionImmediate();
      if (!isPipActive) {
        updateMediaSession(false, video.currentTime, video.duration);
      }
      if (onPause) onPause();
    };

    const handleEnded = async () => {
      // Don't save position at the end - user should start from beginning next time
      // But we can optionally save it if you want to resume from end
      // await savePlaybackPositionImmediate();
      
      if (!isPipActive) {
        updateMediaSession(false, video.currentTime, video.duration);
      }
      if (onEnded) onEnded();
    };

    const handleError = (e: any) => {
      setHasError(true);
      setIsLoading(false);
      if (onError) onError(e);
    };

    const handleLoadStart = () => {
      setIsLoading(true);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      savePlaybackPosition(); // Debounced save
      if (!isPipActive) {
        updateMediaSession(!video.paused, video.currentTime, video.duration);
      }
    };

    const handleSeeked = () => {
      if (!isPipActive) {
        updateMediaSession(!video.paused, video.currentTime, video.duration);
      }
    };

    const handleLoadedMetadata = () => {
      if (!isPipActive) {
        updateMediaSession(!video.paused, video.currentTime, video.duration);
      }
    };

    const handleEnterPictureInPicture = () => {
      setIsPipActive(true);
      setPipContentId(null);
    };

    const handleLeavePictureInPicture = () => {
      setIsPipActive(false);
      setPipContentId(null);
    };

    const handleWindowEnterPictureInPicture = () => {
      setIsPipActive(true);
      setPipContentId(null);
    };

    const handleWindowLeavePictureInPicture = () => {
      setIsPipActive(false);
      setPipContentId(null);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('enterpictureinpicture', handleEnterPictureInPicture);
    video.addEventListener('leavepictureinpicture', handleLeavePictureInPicture);
    window.addEventListener('enterpictureinpicture', handleWindowEnterPictureInPicture);
    window.addEventListener('leavepictureinpicture', handleWindowLeavePictureInPicture);

    return () => {
      // Save position before cleanup
      if (imageID && video && video.duration && !isNaN(video.currentTime)) {
        videoPlaybackDB.savePosition(
          imageID,
          video.currentTime,
          video.duration,
          src
        ).catch(console.error);
      }

      // Clear timeout
      if (savePositionTimeoutRef.current) {
        clearTimeout(savePositionTimeoutRef.current);
      }

      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('enterpictureinpicture', handleEnterPictureInPicture);
      video.removeEventListener('leavepictureinpicture', handleLeavePictureInPicture);
      window.removeEventListener('enterpictureinpicture', handleWindowEnterPictureInPicture);
      window.removeEventListener('leavepictureinpicture', handleWindowLeavePictureInPicture);
    };
  }, [onPlay, onPause, onEnded, onError, imageID, mediaSessionImage, file, isPipActive, src]);

  if (hasError) {
    return (
      <div className={`flex items-center justify-center bg-black ${className}`}>
        <div className="text-white text-center">
          <div className="text-4xl mb-2">⚠️</div>
          <p className="text-sm">Failed to load video</p>
        </div>
      </div>
    );
  }

  const retry = () => {
    if (retryAttempt >= 1) {
      setError(true);
      return;
    }
    setRetryAttempt(retryAttempt + 1);
  };

  useLayoutEffect(() => {
    const dynamicDriverCompleted = Cookies.get('dynamicDriverCompleted');
    if (!dynamicDriverCompleted) {
      Cookies.set('dynamicDriverCompleted', 'true', {
        expires: 365,
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        priority: 'low'
      });
      driverObj.drive(1)
    }
  }, [])

  return (
    <div className={`relative ${className}`}>
      <div className="poster_blur absolute inset-0 pointer-events-none h-full w-full supports-[filter]:blur-xl blur-2xl">
        <div className="dim bg-background/50 absolute inset-0 w-full h-full" />
        {!error ? (
          <ImageLoad callBack={e => {
            if(e) {
            setMediaSessionImage(e.src);
            callBack && callBack({
              src: e.src,
                colors: e.colors || []
              })
            }
          }} hasAdultTag={false} link={file ? (() => {
            const randomThumbnail = getRandomThumbnail(file.thumbnails)
            if (randomThumbnail) {
              return `/api/load/image/${randomThumbnail}`
            }
            return `/api/load/image/${arrangeDateForThumbnail(file.created_at, retryAttempt)}/${file.unique_id}/thumbnail_${file.filename.split(`.mp4.m3u8`)[0]}.jpg`
          })() : poster} retry={retry} className="w-full h-full object-cover object-center" imageID={imageID} index={0} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted text-xs text-center">
            <span>Failed to load image</span>
          </div>
        )
        }
      </div>
      <div className="relative z-[10000] w-full h-full">
        <video ref={videoRef}
          className={`w-full h-full object-contain transition-all duration-300 ${isPipActive ? 'opacity-0 pointer-events-none' : 'opacity-[1] pointer-events-auto'}`}
          muted={autoplayService.isAutoplayEnabled() ? muted : (muted || autoplayBlocked)}
          loop={loop}
          playsInline={playsInline}
          controls
          preload="metadata"
          autoPlay
        />
        {
          isPipActive && isContentInPip(imageID) && (
            <div onClick={() => toggleDocumentPip(src, videoRef, imageID, file, loop, updateMediaSession)} className="pip_div absolute bottom-0 left-0 w-full h-full flex items-center justify-center gap-2 flex-col backdrop-blur-sm cursor-pointer hover:bg-background/70 transition-all duration-300">
              <PictureInPicture2 className="w-12 h-12 text-white" />
              <h1 className="text-white text-xl">You are in Picture in Picture mode</h1>
              <p className="text-white/70 text-sm">Click to exit</p>
            </div>
          )
        }
        {(!isPipActive || !isContentInPip(imageID)) && supportsPip && (
          <button
          id="picture_in_picture_button"
            onClick={() => toggleDocumentPip(src, videoRef, imageID, file, loop, updateMediaSession)}
            className="absolute top-4 right-4 z-[10001] bg-black/50 hover:bg-black/70 text-white p-2 rounded-lg backdrop-blur-sm transition-all duration-200"
            title="Open in Picture-in-Picture"
          >
            <PictureInPicture2 className="w-5 h-5" />
          </button>
        )}
        {isPipActive && !isContentInPip(imageID) && (
          <div className="absolute top-4 left-4 z-[10001] bg-orange-500/80 text-white px-3 py-1 rounded-lg backdrop-blur-sm text-sm font-medium">
            Another video is playing in Picture-in-Picture
          </div>
        )}
        {showAutoplayPrompt && autoPlay && (
          <div className="absolute inset-0 z-[10002] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-background/95 border border-border rounded-lg p-6 max-w-md mx-4 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                {videoRef.current?.muted ? (
                  <VolumeX className="w-6 h-6 text-muted-foreground" />
                ) : (
                  <Volume2 className="w-6 h-6 text-primary" />
                )}
                <h3 className="text-lg font-semibold">Enable Autoplay with Sound</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Click the button below to enable autoplay with sound. This will allow videos to automatically play with sound on future visits.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    autoplayService.enableAutoplay();
                    setShowAutoplayPrompt(false);
                    const video = videoRef.current;
                    if (video) {
                      video.muted = false;
                      try {
                        await video.play();
                        setAutoplayBlocked(false);
                      } catch (error) {
                        console.error('Failed to play after enabling autoplay:', error);
                      }
                    }
                  }}
                  className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors font-medium"
                >
                  Enable Autoplay
                </button>
                <button
                  onClick={() => {
                    setShowAutoplayPrompt(false);
                    const video = videoRef.current;
                    if (video && !video.paused) {
                      // Keep playing but muted
                      video.muted = true;
                    }
                  }}
                  className="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-center">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mb-2"></div>
            <p className="text-sm">Loading...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default HLSPlayer;