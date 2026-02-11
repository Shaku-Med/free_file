import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

interface PictureInPictureContextType {
  isPipActive: boolean;
  setIsPipActive: (active: boolean) => void;
  pipWindow: Window | null;
  setPipWindow: (window: Window | null) => void;
  supportsPip: boolean;
  setSupportsPip: (supported: boolean) => void;
  pipVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  pipHlsRef: React.MutableRefObject<null>;
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
  const pipHlsRef = useRef<null>(null);
  const pipMainVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipUpdateMediaSessionRef = useRef<((playing: boolean, time: number, duration: number) => void) | null>(null);

  const closePip = useCallback(() => {
    setPipWindow((pw) => {
      if (pw && !pw.closed) pw.close();
      return null;
    });
    pipVideoRef.current = null;
    pipMainVideoRef.current = null;
    pipUpdateMediaSessionRef.current = null;
    setIsPipActive(false);
    setPipContentId(null);
  }, []);

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

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'pip-closing') return;
      const mainVideo = pipMainVideoRef.current;
      const time = typeof e.data?.time === 'number' ? e.data.time : 0;
      if (mainVideo) {
        mainVideo.currentTime = time;
        mainVideo.muted = false;
        mainVideo.play().catch(() => {});
      }
      if (pipUpdateMediaSessionRef.current) {
        pipUpdateMediaSessionRef.current(true, time, mainVideo?.duration ?? 0);
      }
      closePip();
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [closePip]);

  useEffect(() => {
    if (!pipWindow) return;
    const id = setInterval(() => {
      if (pipWindow.closed) {
        closePip();
      }
    }, 500);
    return () => clearInterval(id);
  }, [pipWindow, closePip]);

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
        width: 420,
        height: 320,
      });

      pipMainVideoRef.current = videoRef.current ?? null;
      pipUpdateMediaSessionRef.current = updateMediaSession ?? null;

      const currentTime = videoRef.current?.currentTime ?? 0;
      const origin = window.location.origin;
      const params = new URLSearchParams({
        src,
        id: contentId,
        loop: String(Boolean(loop)),
        t: String(currentTime),
      });
      pw.location.href = `${origin}/pip?${params.toString()}`;

      setPipWindow(pw);
      setIsPipActive(true);
      setPipContentId(contentId);

      if (videoRef.current) {
        videoRef.current.muted = true;
        videoRef.current.pause();
      }
    } catch (error) {
      console.error('Error opening Document PiP:', error);
    }
  }, [pipWindow, pipContentId, closePip]);

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
