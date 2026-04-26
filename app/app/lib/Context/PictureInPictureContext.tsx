import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import {
  getPipImplementationForDevice,
  probeAnyPipSupported,
  type PipImplementationKind,
} from '~/lib/pip/pipCapabilities';

/** Which PiP path is active — native/WebKit use the same `<video>` element (must keep playing). */
export type ActivePipKind = Exclude<PipImplementationKind, 'none'>;

interface PictureInPictureContextType {
  isPipActive: boolean;
  setIsPipActive: (active: boolean) => void;
  pipWindow: Window | null;
  setPipWindow: (window: Window | null) => void;
  /** Current PiP implementation, or null when inactive. Mirrors internal ref for UI logic. */
  activePipKind: ActivePipKind | null;
  supportsPip: boolean;
  setSupportsPip: (supported: boolean) => void;
  pipVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  pipHlsRef: React.MutableRefObject<null>;
  pipContentId: string | null;
  setPipContentId: (id: string | null) => void;
  toggleDocumentPip: (src: string, videoRef: React.RefObject<HTMLVideoElement | null>, contentId: string, file?: any, loop?: boolean, updateMediaSession?: (isPlaying: boolean, currentTime: number, duration: number) => void) => Promise<void>;
  closePip: () => void;
  isContentInPip: (contentId: string) => boolean;
  /** Browser UI opened native PiP (not our button) — sync session so custom overlay / state match. */
  notifyBrowserDrivenNativePipEntered: (video: HTMLVideoElement, contentId: string) => void;
  /** Browser / WebKit entered presentation-mode PiP — sync session (e.g. iOS Safari). */
  notifyBrowserDrivenWebKitPipEntered: (video: HTMLVideoElement, contentId: string) => void;
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

/** iOS/WebKit often flips `muted` right after PiP — re-apply if the user was playing with sound. */
export function restoreVideoAudioAfterSystemPip(video: HTMLVideoElement, wantSound: boolean) {
  if (!wantSound) return;
  const apply = () => {
    if (!wantSound) return;
    video.muted = false;
    if (video.volume === 0) video.volume = 1;
  };
  apply();
  requestAnimationFrame(apply);
  window.setTimeout(apply, 0);
  window.setTimeout(apply, 100);
}

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
  const [activePipKind, setActivePipKind] = useState<ActivePipKind | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipHlsRef = useRef<null>(null);
  const pipMainVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipUpdateMediaSessionRef = useRef<((playing: boolean, time: number, duration: number) => void) | null>(null);
  const activePipKindRef = useRef<ActivePipKind | null>(null);

  const assignPipKind = useCallback((k: ActivePipKind | null) => {
    activePipKindRef.current = k;
    setActivePipKind(k);
  }, []);
  const nativePipCleanupRef = useRef<(() => void) | null>(null);
  const webkitPipCleanupRef = useRef<(() => void) | null>(null);

  const detachNativePipListeners = useCallback(() => {
    nativePipCleanupRef.current?.();
    nativePipCleanupRef.current = null;
  }, []);

  const detachWebkitPipListeners = useCallback(() => {
    webkitPipCleanupRef.current?.();
    webkitPipCleanupRef.current = null;
  }, []);

  const closePip = useCallback(() => {
    detachNativePipListeners();
    detachWebkitPipListeners();

    const kind = activePipKindRef.current;
    assignPipKind(null);

    const mainVideo = pipMainVideoRef.current;

    if (kind === 'native-video' && mainVideo && document.pictureInPictureElement === mainVideo) {
      document.exitPictureInPicture().catch(() => {});
    }

    if (kind === 'webkit-presentation' && mainVideo) {
      const wv = mainVideo as HTMLVideoElement & {
        webkitPresentationMode?: string;
        webkitSetPresentationMode?: (mode: string) => void;
      };
      try {
        if (
          typeof wv.webkitSetPresentationMode === 'function' &&
          wv.webkitPresentationMode === 'picture-in-picture'
        ) {
          wv.webkitSetPresentationMode('inline');
        }
      } catch {
        /* ignore */
      }
    }

    setPipWindow((pw) => {
      if (pw && !pw.closed) pw.close();
      return null;
    });
    pipVideoRef.current = null;
    pipMainVideoRef.current = null;
    pipUpdateMediaSessionRef.current = null;
    setIsPipActive(false);
    setPipContentId(null);
  }, [assignPipKind, detachNativePipListeners, detachWebkitPipListeners]);

  const documentPipShellOpen = useCallback((): boolean => {
    try {
      const w = (window as any).documentPictureInPicture?.window;
      return Boolean(w && !w.closed);
    } catch {
      return false;
    }
  }, []);

  const notifyBrowserDrivenNativePipEntered = useCallback(
    (video: HTMLVideoElement, contentId: string) => {
      if (documentPipShellOpen() && activePipKindRef.current === 'document') return;
      if (document.pictureInPictureElement !== video) return;
      if (activePipKindRef.current === 'native-video' && pipMainVideoRef.current === video) return;

      const wantSound = !video.muted && video.volume > 0;
      pipMainVideoRef.current = video;
      pipUpdateMediaSessionRef.current = null;
      assignPipKind('native-video');
      setPipContentId(contentId);
      setIsPipActive(true);

      detachNativePipListeners();
      const onLeave = () => {
        if (activePipKindRef.current !== 'native-video') return;
        if (pipMainVideoRef.current !== video) return;
        closePip();
      };
      video.addEventListener('leavepictureinpicture', onLeave);
      nativePipCleanupRef.current = () => {
        video.removeEventListener('leavepictureinpicture', onLeave);
      };

      restoreVideoAudioAfterSystemPip(video, wantSound);
    },
    [assignPipKind, closePip, detachNativePipListeners, documentPipShellOpen],
  );

  const notifyBrowserDrivenWebKitPipEntered = useCallback(
    (video: HTMLVideoElement, contentId: string) => {
      if (documentPipShellOpen() && activePipKindRef.current === 'document') return;
      const wv = video as HTMLVideoElement & { webkitPresentationMode?: string };
      if (wv.webkitPresentationMode !== 'picture-in-picture') return;
      if (activePipKindRef.current === 'webkit-presentation' && pipMainVideoRef.current === video) return;

      const wantSound = !video.muted && video.volume > 0;
      pipMainVideoRef.current = video;
      pipUpdateMediaSessionRef.current = null;
      assignPipKind('webkit-presentation');
      setPipContentId(contentId);
      setIsPipActive(true);

      detachWebkitPipListeners();
      const onPresentation = () => {
        if (activePipKindRef.current !== 'webkit-presentation') return;
        const mode = (video as HTMLVideoElement & { webkitPresentationMode?: string }).webkitPresentationMode;
        if (mode !== 'picture-in-picture') {
          closePip();
        } else {
          restoreVideoAudioAfterSystemPip(video, wantSound);
        }
      };
      video.addEventListener('webkitpresentationmodechanged', onPresentation);
      webkitPipCleanupRef.current = () => {
        video.removeEventListener('webkitpresentationmodechanged', onPresentation);
      };

      restoreVideoAudioAfterSystemPip(video, wantSound);
    },
    [assignPipKind, closePip, detachWebkitPipListeners, documentPipShellOpen],
  );

  useEffect(() => {
    setSupportsPip(probeAnyPipSupported());

    const checkPipState = () => {
      if ((window as any).documentPictureInPicture?.window && !(window as any).documentPictureInPicture.window.closed) {
        setIsPipActive(true);
        setPipWindow((window as any).documentPictureInPicture.window);
        assignPipKind('document');
      }
    };

    checkPipState();
  }, [assignPipKind]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;

      const shell = (window as any).documentPictureInPicture?.window as Window | undefined;

      /** In-app link from PiP iframe → shell relay → here: close PiP and navigate this window. */
      if (e.data?.type === 'pip-navigate' && typeof e.data.href === 'string') {
        if (!shell || e.source !== shell) return;
        closePip();
        try {
          const next = new URL(e.data.href, window.location.origin);
          window.location.assign(next.href);
        } catch {
          window.location.assign(e.data.href);
        }
        return;
      }

      if (e.data?.type !== 'pip-closing') return;
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
    const video = videoRef.current;
    const impl = getPipImplementationForDevice(video);

    if (impl === 'none') {
      return;
    }

    if (isPipActive && pipContentId === contentId) {
      closePip();
      return;
    }

    if (isPipActive) {
      closePip();
    }

    if (impl === 'native-video') {
      if (!video) return;
      try {
        const wantSound = !video.muted && video.volume > 0;
        pipMainVideoRef.current = video;
        pipUpdateMediaSessionRef.current = updateMediaSession ?? null;
        assignPipKind('native-video');
        setPipContentId(contentId);

        detachNativePipListeners();
        const onLeave = () => {
          if (activePipKindRef.current !== 'native-video') return;
          closePip();
        };
        video.addEventListener('leavepictureinpicture', onLeave);
        nativePipCleanupRef.current = () => {
          video.removeEventListener('leavepictureinpicture', onLeave);
        };

        await video.requestPictureInPicture();
        setIsPipActive(true);
        restoreVideoAudioAfterSystemPip(video, wantSound);
      } catch (error) {
        console.error('Error entering native Picture-in-Picture:', error);
        detachNativePipListeners();
        assignPipKind(null);
        pipMainVideoRef.current = null;
        pipUpdateMediaSessionRef.current = null;
        setPipContentId(null);
        setIsPipActive(false);
      }
      return;
    }

    if (impl === 'webkit-presentation') {
      if (!video) return;
      const wv = video as HTMLVideoElement & {
        webkitSetPresentationMode?: (mode: string) => void;
        webkitPresentationMode?: string;
      };
      try {
        const wantSound = !video.muted && video.volume > 0;
        pipMainVideoRef.current = video;
        pipUpdateMediaSessionRef.current = updateMediaSession ?? null;
        assignPipKind('webkit-presentation');
        setPipContentId(contentId);

        detachWebkitPipListeners();
        const onPresentation = () => {
          if (activePipKindRef.current !== 'webkit-presentation') return;
          if (wv.webkitPresentationMode !== 'picture-in-picture') {
            closePip();
          } else {
            restoreVideoAudioAfterSystemPip(video, wantSound);
          }
        };
        video.addEventListener('webkitpresentationmodechanged', onPresentation);
        webkitPipCleanupRef.current = () => {
          video.removeEventListener('webkitpresentationmodechanged', onPresentation);
        };

        if (typeof wv.webkitSetPresentationMode === 'function') {
          wv.webkitSetPresentationMode('picture-in-picture');
        }
        setIsPipActive(true);
        restoreVideoAudioAfterSystemPip(video, wantSound);
      } catch (error) {
        console.error('Error entering WebKit Picture-in-Picture:', error);
        detachWebkitPipListeners();
        assignPipKind(null);
        pipMainVideoRef.current = null;
        pipUpdateMediaSessionRef.current = null;
        setPipContentId(null);
        setIsPipActive(false);
      }
      return;
    }

    if (!(window as any).documentPictureInPicture) {
      return;
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
      doc.body.style.position = 'relative';
      doc.body.style.overflow = 'hidden';

      const pipStyles = doc.createElement('style');
      pipStyles.textContent = `
        @keyframes pip-iframe-spin { to { transform: rotate(360deg); } }
        #pip-iframe-loader {
          position: absolute; inset: 0; z-index: 10; display: flex;
          align-items: center; justify-content: center; flex-direction: column; gap: 12px;
          background: #000; color: rgba(255,255,255,0.85); font: 13px/1.4 system-ui, sans-serif;
        }
        #pip-iframe-loader .pip-spinner {
          width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.22);
          border-top-color: #fff; border-radius: 50%;
          animation: pip-iframe-spin 0.75s linear infinite;
        }
      `;
      doc.head.appendChild(pipStyles);

      const pipRelayScript = doc.createElement('script');
      pipRelayScript.textContent = `(function(O){
  window.addEventListener("message",function(ev){
    if(ev.origin!==O)return;
    var d=ev.data;
    if(!d||d.type!=="pip-command")return;
    try{
      if(!window.opener||window.opener.closed)return;
      if(d.command==="navigate"&&typeof d.href==="string"){
        window.opener.postMessage({type:"pip-navigate",href:d.href},O);
      }else if(d.command==="closing"){
        window.opener.postMessage({type:"pip-closing",time:d.time,id:d.id},O);
      }
    }catch(_){}
  });
})(${JSON.stringify(origin)});`;
      doc.head.appendChild(pipRelayScript);

      const loader = doc.createElement('div');
      loader.id = 'pip-iframe-loader';
      loader.setAttribute('role', 'status');
      loader.setAttribute('aria-live', 'polite');
      loader.setAttribute('aria-label', 'Loading');
      const spinner = doc.createElement('div');
      spinner.className = 'pip-spinner';
      const label = doc.createElement('span');
      label.textContent = 'Loading…';
      loader.appendChild(spinner);
      loader.appendChild(label);
      doc.body.appendChild(loader);

      const hideLoader = () => {
        loader.style.display = 'none';
      };
      const loadTimeout = window.setTimeout(hideLoader, 45_000);

      const iframe = doc.createElement('iframe');
      iframe.src = pipUrl;
      iframe.title = 'Picture-in-Picture';
      iframe.style.border = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.display = 'block';
      iframe.style.position = 'relative';
      iframe.style.zIndex = '1';
      iframe.setAttribute(
        'allow',
        'autoplay; fullscreen; encrypted-media; picture-in-picture'
      );
      iframe.addEventListener('load', () => {
        window.clearTimeout(loadTimeout);
        hideLoader();
      });
      iframe.addEventListener('error', () => {
        window.clearTimeout(loadTimeout);
        hideLoader();
      });
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

      assignPipKind('document');
      setPipWindow(pw);
      setIsPipActive(true);
      setPipContentId(contentId);

      if (videoRef.current) {
        videoRef.current.pause();
      }
    } catch (error) {
      console.error('Error opening Document PiP:', error);
      assignPipKind(null);
    }
  }, [
    assignPipKind,
    isPipActive,
    pipContentId,
    closePip,
    detachNativePipListeners,
    detachWebkitPipListeners,
  ]);

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
    activePipKind,
    supportsPip,
    setSupportsPip,
    pipVideoRef,
    pipHlsRef,
    pipContentId,
    setPipContentId,
    toggleDocumentPip,
    closePip,
    isContentInPip,
    notifyBrowserDrivenNativePipEntered,
    notifyBrowserDrivenWebKitPipEntered,
  };

  return (
    <PictureInPictureContext.Provider value={value}>
      {children}
    </PictureInPictureContext.Provider>
  );
};
