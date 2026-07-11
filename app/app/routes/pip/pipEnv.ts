export const PIP_MESSAGE_ORIGIN =
  typeof window !== 'undefined' ? window.location.origin : '';

export function getDocumentPictureInPicture(): { window?: Window } | undefined {
  return (window as unknown as { documentPictureInPicture?: { window?: Window } })
    .documentPictureInPicture;
}

export function isPipSurfaceAllowed(embed: boolean): boolean {
  if (typeof window === 'undefined') return false;
  if (getDocumentPictureInPicture()?.window === window) return true;
  return embed && window.parent !== window && window.frameElement != null;
}

export function isPipChromeRoute(pathname: string): boolean {
  if (pathname === '/pip') return true;
  return pathname.startsWith('/pip/');
}

export function getOpenerForPipHandshake(): Window | null {
  if (typeof window === 'undefined') return null;
  if (window.opener) return window.opener;
  try {
    const top = window.top;
    if (top && top !== window && top.opener) return top.opener;
  } catch {
    return null;
  }
  return null;
}

/** Relayed from Document PiP shell → main app (see PictureInPictureContext). */
export type PipCommandMessage =
  | { type: 'pip-command'; command: 'navigate'; href: string }
  | { type: 'pip-command'; command: 'closing'; time: number; id: string; paused?: boolean }
  | { type: 'pip-command'; command: 'state'; time: number; paused: boolean; id: string };

export type PipPlaybackState = { time: number; paused: boolean; id: string };

// Last state reported by the active PiP player; used by the beforeunload closing handshake.
let lastPipPlaybackState: PipPlaybackState | null = null;

export function getLastPipPlaybackState(): PipPlaybackState | null {
  return lastPipPlaybackState;
}

/**
 * PiP UI runs in an iframe inside the Document PiP window; `window.opener` is usually null there.
 * Post to `parent` so the shell can forward to the main app, or post directly to opener when not framed.
 */
export function requestNavigateFromPipToMain(href: string) {
  if (typeof window === 'undefined' || !PIP_MESSAGE_ORIGIN) return;
  const msg: PipCommandMessage = { type: 'pip-command', command: 'navigate', href };
  if (window.parent !== window) {
    window.parent.postMessage(msg, PIP_MESSAGE_ORIGIN);
  } else {
    getOpenerForPipHandshake()?.postMessage({ type: 'pip-navigate', href }, PIP_MESSAGE_ORIGIN);
  }
}

export function requestPipClosingHandshake(time: number, id: string, paused = false) {
  if (typeof window === 'undefined' || !PIP_MESSAGE_ORIGIN) return;
  const msg: PipCommandMessage = { type: 'pip-command', command: 'closing', time, id, paused };
  if (window.parent !== window) {
    window.parent.postMessage(msg, PIP_MESSAGE_ORIGIN);
  } else {
    getOpenerForPipHandshake()?.postMessage({ type: 'pip-closing', time, id, paused }, PIP_MESSAGE_ORIGIN);
  }
}

/** Live play/pause/time sync from the PiP player to the main window (stored there, applied on exit). */
export function reportPipStateToMain(time: number, paused: boolean, id: string) {
  if (typeof window === 'undefined' || !PIP_MESSAGE_ORIGIN) return;
  lastPipPlaybackState = { time, paused, id };
  const msg: PipCommandMessage = { type: 'pip-command', command: 'state', time, paused, id };
  if (window.parent !== window) {
    window.parent.postMessage(msg, PIP_MESSAGE_ORIGIN);
  } else {
    getOpenerForPipHandshake()?.postMessage({ type: 'pip-state', time, paused, id }, PIP_MESSAGE_ORIGIN);
  }
}
