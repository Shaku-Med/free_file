import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import Hls from 'hls.js';

interface PictureInPictureContextType {
  isPipActive: boolean;
  setIsPipActive: (active: boolean) => void;
  pipWindow: Window | null;
  setPipWindow: (window: Window | null) => void;
  supportsPip: boolean;
  setSupportsPip: (supported: boolean) => void;
  pipVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  pipHlsRef: React.MutableRefObject<Hls | null>;
  pipContentId: string | null;
  setPipContentId: (id: string | null) => void;
  toggleDocumentPip: (src: string, videoRef: React.RefObject<HTMLVideoElement | null>, contentId: string, file?: any, loop?: boolean, updateMediaSession?: (isPlaying: boolean, currentTime: number, duration: number) => void) => Promise<void>;
  closePip: () => void;
  isContentInPip: (contentId: string) => boolean;
}

const PictureInPictureContext = createContext<PictureInPictureContextType | undefined>(undefined);

export const usePictureInPictureContext = () => {
  const context = useContext(PictureInPictureContext);
  if (!context) {
    throw new Error('usePictureInPictureContext must be used within a PictureInPictureProvider');
  }
  return context;
};

interface PictureInPictureProviderProps {
  children: React.ReactNode;
}

export const PictureInPictureProvider: React.FC<PictureInPictureProviderProps> = ({ children }) => {
  const [isPipActive, setIsPipActive] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [supportsPip, setSupportsPip] = useState(false);
  const [pipContentId, setPipContentId] = useState<string | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipHlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    setSupportsPip('documentPictureInPicture' in window);

    const checkPipState = () => {
      if (window.documentPictureInPicture?.window && !window.documentPictureInPicture.window.closed) {
        setIsPipActive(true);
        setPipWindow(window.documentPictureInPicture.window);
      }
    };

    checkPipState();
  }, []);

  const closePip = useCallback(() => {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
    }
    if (pipHlsRef.current) {
      pipHlsRef.current.destroy();
      pipHlsRef.current = null;
    }
    pipVideoRef.current = null;
    setPipWindow(null);
    setIsPipActive(false);
    setPipContentId(null);
  }, [pipWindow]);

  const toggleDocumentPip = useCallback(async (src: string, videoRef: React.RefObject<HTMLVideoElement | null>, contentId: string, file?: any, loop?: boolean, updateMediaSession?: (isPlaying: boolean, currentTime: number, duration: number) => void) => {
    if (!window.documentPictureInPicture) {
      alert('Document Picture-in-Picture is not supported in your browser.');
      return;
    }

    if (pipWindow && !pipWindow.closed) {
      if (pipContentId === contentId) {
        closePip();
        if (videoRef.current) {
          videoRef.current.muted = false;
        }
        return;
      } else {
        closePip();
      }
    }

    try {
      const pw = await window.documentPictureInPicture.requestWindow({
        width: 500,
        height: 400,
      });

      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
          const style = pw.document.createElement('style');
          style.textContent = cssRules;
          pw.document.head.appendChild(style);
        } catch (e) {
          const link = pw.document.createElement('link');
          link.rel = 'stylesheet';
          if (styleSheet.href) {
            link.href = styleSheet.href;
            pw.document.head.appendChild(link);
          }
        }
      });

      const pipVideo = pw.document.createElement('video');
      pipVideo.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; background: #000;';
      pipVideo.controls = true;
      pipVideo.muted = false;
      pipVideo.loop = loop || false;
      pipVideo.playsInline = true;

      pipVideoRef.current = pipVideo;

      if (videoRef.current) {
        pipVideo.currentTime = videoRef.current.currentTime;
        videoRef.current.muted = true;
        if (!videoRef.current.paused) {
          pipVideo.play();
        }
      }

      const isHLSStream = src.includes('.m3u8');

      if (isHLSStream && Hls.isSupported()) {
        const pipHls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          startLevel: -1,
          capLevelToPlayerSize: true,
        });

        pipHlsRef.current = pipHls;
        pipHls.loadSource(src);
        pipHls.attachMedia(pipVideo);
      } else {
        pipVideo.src = src;
      }

      const syncFromPipToMain = () => {
        if (videoRef.current && pipVideo) {
          videoRef.current.currentTime = pipVideo.currentTime;
          if (!pipVideo.paused && videoRef.current.paused) {
            videoRef.current.play();
          } else if (pipVideo.paused && !videoRef.current.paused) {
            videoRef.current.pause();
          }
        }
      };

      const handlePipPlay = () => {
        syncFromPipToMain();
        if (updateMediaSession) {
          updateMediaSession(true, pipVideo.currentTime, pipVideo.duration);
        }
      };

      const handlePipPause = () => {
        syncFromPipToMain();
        if (updateMediaSession) {
          updateMediaSession(false, pipVideo.currentTime, pipVideo.duration);
        }
      };

      const handlePipTimeUpdate = () => {
        syncFromPipToMain();
        if (updateMediaSession) {
          updateMediaSession(!pipVideo.paused, pipVideo.currentTime, pipVideo.duration);
        }
      };

      const handlePipSeeked = () => {
        syncFromPipToMain();
        if (updateMediaSession) {
          updateMediaSession(!pipVideo.paused, pipVideo.currentTime, pipVideo.duration);
        }
      };

      pipVideo.addEventListener('play', handlePipPlay);
      pipVideo.addEventListener('pause', handlePipPause);
      pipVideo.addEventListener('seeked', handlePipSeeked);
      pipVideo.addEventListener('timeupdate', handlePipTimeUpdate);

      pw.document.body.appendChild(pipVideo);

      pw.addEventListener('pagehide', () => {
        if (videoRef.current && pipVideo) {
          videoRef.current.currentTime = pipVideo.currentTime;
          videoRef.current.muted = false;
          if (!pipVideo.paused) {
            videoRef.current.play();
          }
        }
        closePip();
      });

      setPipWindow(pw);
      setIsPipActive(true);
      setPipContentId(contentId);

      if (videoRef.current) {
        videoRef.current.pause();
      }
    } catch (error) {
      console.error('Error opening Document PiP:', error);
    }
  }, [pipWindow, closePip]);

  const isContentInPip = useCallback((contentId: string) => {
    if (!isPipActive) return false;
    if (pipContentId === null) return true;
    return pipContentId === contentId;
  }, [pipContentId, isPipActive]);

  const value: PictureInPictureContextType = {
    isPipActive,
    setIsPipActive,
    pipWindow,
    setPipWindow,
    supportsPip,
    setSupportsPip,
    pipVideoRef,
    pipHlsRef,
    pipContentId,
    setPipContentId,
    toggleDocumentPip,
    closePip,
    isContentInPip
  };

  return (
    <PictureInPictureContext.Provider value={value}>
      {children}
    </PictureInPictureContext.Provider>
  );
};
