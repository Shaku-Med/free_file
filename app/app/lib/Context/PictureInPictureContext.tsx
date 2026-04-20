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

const PIP_PHONE_WIDTH = 390;
const PIP_PHONE_HEIGHT = 844;

const MAX_SEEK_SECONDS = 24 * 60 * 60;

function sanitizeSeekSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return Math.min(value, MAX_SEEK_SECONDS);
}

function isTrustedPipIframeSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  try {
    const u = new URL(src, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith('/pip');
  } catch {
    return false;
  }
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
      if ((window as any).documentPictureInPicture?.window && !(window as any).documentPictureInPicture.window.closed) {
        setIsPipActive(true);
        setPipWindow((window as any).documentPictureInPicture.window);
      }
    };

    checkPipState();
  }, []);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'pip-closing') return;
      const shell = (window as any).documentPictureInPicture?.window;
      if (!shell) return;
      const fromShell = e.source === shell;
      let fromPipIframe = false;
      try {
        const iframe = shell.document?.querySelector('iframe');
        const iframeSrc =
          (iframe as HTMLIFrameElement | undefined)?.src ||
          iframe?.getAttribute('src');
        if (
          iframe?.contentWindow === e.source &&
          isTrustedPipIframeSrc(iframeSrc)
        ) {
          fromPipIframe = true;
        }
      } catch {}
      if (!fromShell && !fromPipIframe) return;

      const payload = e.data as { time?: unknown; id?: unknown };
      const time = sanitizeSeekSeconds(payload.time);
      const payloadId = typeof payload.id === 'string' ? payload.id : null;
      if (
        pipContentId !== null &&
        payloadId !== null &&
        payloadId !== pipContentId
      ) {
        return;
      }

      const mainVideo = pipMainVideoRef.current;
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
  }, [closePip, pipContentId]);

  useEffect(() => {
    if (!pipWindow) return;
    const id = setInterval(() => {
      const live = (window as any).documentPictureInPicture?.window;
      if (!live || live.closed) closePip();
    }, 500);
    return () => clearInterval(id);
  }, [pipWindow, closePip]);

  const toggleDocumentPip = useCallback(async (src: string, videoRef: React.RefObject<HTMLVideoElement | null>, contentId: string, file?: any, loop?: boolean, updateMediaSession?: (isPlaying: boolean, currentTime: number, duration: number) => void) => {
    if (!(window as any).documentPictureInPicture) {
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
      const pw = await (window as any).documentPictureInPicture.requestWindow({
        width: PIP_PHONE_WIDTH,
        height: PIP_PHONE_HEIGHT,
        preferInitialWindowPlacement: true,
      });

      pipMainVideoRef.current = videoRef.current ?? null;
      pipUpdateMediaSessionRef.current = updateMediaSession ?? null;

      const currentTime = videoRef.current?.currentTime ?? 0;
      const origin = window.location.origin;
      const params = new URLSearchParams({
        src,
        loop: String(Boolean(loop)),
        t: String(currentTime),
        embed: '1',
      });
      const pipUrl = `${origin}/pip/${encodeURIComponent(contentId)}?${params.toString()}`;

      const doc = pw.document;
      doc.documentElement.style.height = '100%';
      doc.body.style.margin = '0';
      doc.body.style.height = '100%';
      const iframe = doc.createElement('iframe');
      iframe.src = pipUrl;
      iframe.title = 'Picture-in-Picture';
      iframe.style.border = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.display = 'block';
      iframe.setAttribute(
        'allow',
        'autoplay; fullscreen; encrypted-media; picture-in-picture'
      );
      doc.body.appendChild(iframe);

      const lockSrc = `(function(){
        var W=${PIP_PHONE_WIDTH},H=${PIP_PHONE_HEIGHT};
        function lock(){
          try{
            if (typeof window.outerWidth==="number" && typeof window.outerHeight==="number" &&
                (window.outerWidth!==W || window.outerHeight!==H)) {
              window.resizeTo(W,H);
            }
          }catch(_){}
        }
        function rafLock(){ requestAnimationFrame(lock); }
        window.addEventListener("resize",rafLock);
        rafLock();
        setTimeout(rafLock,0);
      })();`;
      const lockScript = doc.createElement('script');
      lockScript.textContent = lockSrc;
      doc.body.appendChild(lockScript);

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
