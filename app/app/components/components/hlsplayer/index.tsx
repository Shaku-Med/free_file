import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad';
import type { FileType } from '~/lib/types';
import { arrangeDateForThumbnail } from '~/lib/utils';
import { PictureInPicture2 } from 'lucide-react';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import Cookies from 'js-cookie';
import { driverObj } from '~/lib/Context/Context';

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
      window: Window | null;
    };
  }
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
  file = null
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState<number>(0);
  const [error, setError] = useState<boolean>(false);
  const [mediaSessionImage, setMediaSessionImage] = useState<string | null>(null);
  
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
      const title = file.filename.replace('.mp4.m3u8', '');

      navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: 'Video Player',
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

        if (imageID && (window as any)[`_${imageID}`]?.playState) {
          const cachedState = (window as any)[`_${imageID}`].playState;
          video.currentTime = cachedState.currentTime || 0;
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

    const playVideo = () => {
      if (isPipActive && !isContentInPip(imageID)) {
        return;
      }
      video.play().catch(console.error);
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const savePlayState = () => {
      if (imageID) {
        const currentCache = (window as any)[`_${imageID}`] || {};
        (window as any)[`_${imageID}`] = {
          ...currentCache,
          playState: {
            currentTime: video.currentTime,
            paused: video.paused,
            duration: video.duration
          }
        };
      }
    };

    const handlePlay = () => {
      if (isPipActive && !isContentInPip(imageID)) {
        video.pause();
        return;
      }
      
      setIsLoading(false);
      savePlayState();
      if (!isPipActive) {
        updateMediaSession(true, video.currentTime, video.duration);
      }
      if (onPlay) onPlay();
    };

    const handlePause = () => {
      savePlayState();
      if (!isPipActive) {
        updateMediaSession(false, video.currentTime, video.duration);
      }
      if (onPause) onPause();
    };

    const handleEnded = () => {
      savePlayState();
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
      savePlayState();
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
  }, [onPlay, onPause, onEnded, onError, imageID, mediaSessionImage, file, isPipActive]);

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
      driverObj.drive(1)
      Cookies.set('dynamicDriverCompleted', 'true');
    }
  }, [])

  return (
    <div className={`relative ${className}`}>
      <div className="poster_blur absolute inset-0 pointer-events-none h-full w-full supports-[filter]:blur-xl blur-2xl">
        <div className="dim bg-background/50 absolute inset-0 w-full h-full" />
        {!error ? (
          <ImageLoad callBack={src => {
            setMediaSessionImage(src);
          }} link={file ? `/api/load/image/${arrangeDateForThumbnail(file.created_at, retryAttempt)}/${file.unique_id}/thumbnail_${file.filename.split(`.mp4.m3u8`)[0]}.jpg` : poster} retry={retry} className="w-full h-full object-cover object-center" imageID={imageID} index={0} />
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
          muted={muted}
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