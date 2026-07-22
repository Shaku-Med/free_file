/**
 * Picture-in-Picture capability probes.
 * - Document PiP: Chromium custom window + iframe (best for our /pip UI).
 * - Windapp PiP: Electron always-on-top window loading /pip (same UI as Document PiP).
 * - Native video PiP: `HTMLVideoElement.requestPictureInPicture()` (default browser UI).
 * - WebKit presentation: iOS Safari `webkitSetPresentationMode('picture-in-picture')`.
 */

import { detectWindapp } from '~/lib/hooks/useWindapp';
import { readPipMode } from '~/lib/pip/pipModePref';

export type PipImplementationKind = 'document' | 'native-video' | 'webkit-presentation' | 'none';

function hasDocumentPictureInPicture(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

/**
 * iOS home-screen web app (standalone). WebKit claims presentation-mode PiP is
 * supported there, but actually entering it silently fails without Safari's
 * chrome — so we treat PiP as unavailable and hide the control entirely.
 */
export function isIosStandaloneApp(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  // `navigator.standalone` is only ever defined (and true) on iOS home-screen apps.
  if (nav.standalone === true) return true;
  try {
    const displayStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const iosDevice =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return displayStandalone && iosDevice;
  } catch {
    return false;
  }
}

/** Standard Video PiP API (Chrome/Android, Firefox, Safari desktop in many cases). */
export function hasNativeVideoPictureInPicture(): boolean {
  if (typeof document === 'undefined' || typeof HTMLVideoElement === 'undefined') return false;
  const doc = document as Document & { pictureInPictureEnabled?: boolean };
  if (doc.pictureInPictureEnabled === false) return false;
  return typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
}

/** iOS Safari and some WebKit builds  check on a real element when possible. */
export function videoSupportsWebKitPresentationPiP(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  const v = video as HTMLVideoElement & {
    webkitSupportsPresentationMode?: (mode: string) => boolean;
  };
  return (
    typeof v.webkitSupportsPresentationMode === 'function' &&
    v.webkitSupportsPresentationMode('picture-in-picture')
  );
}

/**
 * Touch-first narrow viewports: use native / WebKit PiP only (not Document PiP iframe shell).
 */
export function isMobileStyleViewport(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const narrow = window.matchMedia('(max-width: 1023px)').matches;
    const coarse =
      window.matchMedia('(pointer: coarse)').matches ||
      ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    return narrow && coarse;
  } catch {
    return false;
  }
}

/**
 * Pick implementation for this device.
 * Mobile → native/WebKit only; windapp / desktop Document PiP when available.
 */
export function getPipImplementationForDevice(video: HTMLVideoElement | null): PipImplementationKind {
  if (typeof window === 'undefined') return 'none';
  if (isIosStandaloneApp()) return 'none';

  // Desktop app: always use our /pip UI in a floating Electron window.
  if (detectWindapp()) return 'document';

  if (isMobileStyleViewport()) {
    // Mobile always uses the platform default  the style preference never applies.
    if (videoSupportsWebKitPresentationPiP(video)) return 'webkit-presentation';
    if (hasNativeVideoPictureInPicture()) return 'native-video';
    return 'none';
  }

  // Desktop web: the style preference chooses between our compact Document PiP
  // window ("phone", default) and the browser's native PiP ("wide").
  if (readPipMode() === 'wide' && hasNativeVideoPictureInPicture()) {
    return 'native-video';
  }
  if (hasDocumentPictureInPicture()) return 'document';
  if (hasNativeVideoPictureInPicture()) return 'native-video';
  if (videoSupportsWebKitPresentationPiP(video)) return 'webkit-presentation';
  return 'none';
}

export function anyPipSupported(video?: HTMLVideoElement | null): boolean {
  return getPipImplementationForDevice(video ?? null) !== 'none';
}

/**
 * One-time probe for showing the PiP control (no video element yet). Uses a stub `<video>` for WebKit.
 */
export function probeAnyPipSupported(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (isIosStandaloneApp()) return false;
  if (detectWindapp()) return true;
  if (hasDocumentPictureInPicture() && !isMobileStyleViewport()) return true;
  if (hasNativeVideoPictureInPicture()) return true;
  try {
    const stub = document.createElement('video');
    if (videoSupportsWebKitPresentationPiP(stub)) return true;
  } catch {
    /* ignore */
  }
  return false;
}
