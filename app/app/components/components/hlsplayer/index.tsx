import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad';

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
  imageID = ''
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

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

          // hls.on(Hls.Events.MANIFEST_PARSED, (event: any, data: any) => {
          //   console.log('HLS Manifest parsed:', data);
          //   setIsLoading(false);
          // });

          // hls.on(Hls.Events.LEVEL_LOADED, (event: any, data: any) => {
          //   console.log('HLS Level loaded:', data);
          // });

          // hls.on(Hls.Events.FRAG_LOADED, (event: any, data: any) => {
          //   console.log('HLS Fragment loaded:', data);
          // });

          // hls.on(Hls.Events.LEVEL_SWITCHED, (event: any, data: any) => {
          //   console.log('HLS Level switched:', data);
          // });

          // hls.on(Hls.Events.BUFFER_APPENDED, (event: any, data: any) => {
          //   console.log('HLS Buffer appended:', data);
          // });

          // hls.on(Hls.Events.BUFFER_FLUSHED, (event: any, data: any) => {
          //   console.log('HLS Buffer flushed:', data);
          // });

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
  }, [autoPlay]);

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
      setIsLoading(false);
      savePlayState();
      if (onPlay) onPlay();
    };

    const handlePause = () => {
      savePlayState();
      if (onPause) onPause();
    };

    const handleEnded = () => {
      savePlayState();
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
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [onPlay, onPause, onEnded, onError, imageID]);

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

  return (
    <div className={`relative ${className}`}>
      <div className="poster_blur absolute inset-0 pointer-events-none h-full w-full supports-[filter]:blur-xl blur-2xl">
        <div className="dim bg-background/50 absolute inset-0 w-full h-full" />
        <ImageLoad link={poster} setError={() => {}} className="w-full h-full object-cover object-center" imageID={imageID} index={0} />
      </div>
      <div className="relative z-[10000] w-full h-full">
        <video  ref={videoRef}
            className="w-full h-full object-contain"
            muted={muted}
            loop={loop}
            playsInline={playsInline}
            controls
            preload="metadata"
            autoPlay
          />
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
