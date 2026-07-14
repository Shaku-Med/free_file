import { detectWindapp } from '~/lib/hooks/useWindapp';

export const PIP_MESSAGE_ORIGIN =
  typeof window !== 'undefined' ? window.location.origin : '';

/** Same-origin channel for windapp PiP ↔ main (opener is often null in Electron). */
export const PIP_BROADCAST_CHANNEL = 'memories-pip';

export function getDocumentPictureInPicture(): { window?: Window } | undefined {
  return (window as unknown as { documentPictureInPicture?: { window?: Window } })
    .documentPictureInPicture;
}

/** Set on the Electron child window URL when opening our custom PiP. */
export function isWindappPipSurface(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('windapp_pip') === '1';
  } catch {
    return false;
  }
}

export function isPipSurfaceAllowed(embed: boolean): boolean {
  if (typeof window === 'undefined') return false;
  if (getDocumentPictureInPicture()?.window === window) return true;
  // Document PiP shell iframe
  if (embed && window.parent !== window && window.frameElement != null) return true;
  // Windapp child window (opener may be null in Electron)
  if (embed && isWindappPipSurface() && detectWindapp()) return true;
  if (embed && window.opener && !window.opener.closed) return true;
  return false;
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

function broadcastToMain(data: Record<string, unknown>) {
  try {
    const bc = new BroadcastChannel(PIP_BROADCAST_CHANNEL);
    bc.postMessage(data);
    bc.close();
  } catch {
    /* BroadcastChannel unsupported */
  }
}

function postFromTopLevelPip(data: Record<string, unknown>) {
  const opener = getOpenerForPipHandshake();
  if (opener && !opener.closed && PIP_MESSAGE_ORIGIN) {
    opener.postMessage(data, PIP_MESSAGE_ORIGIN);
  }
  // Always broadcast in windapp so main receives even when opener is null.
  if (isWindappPipSurface() || detectWindapp()) {
    broadcastToMain(data);
  }
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
    postFromTopLevelPip({ type: 'pip-navigate', href });
  }
}

export function requestPipClosingHandshake(time: number, id: string, paused = false) {
  if (typeof window === 'undefined' || !PIP_MESSAGE_ORIGIN) return;
  const msg: PipCommandMessage = { type: 'pip-command', command: 'closing', time, id, paused };
  if (window.parent !== window) {
    window.parent.postMessage(msg, PIP_MESSAGE_ORIGIN);
  } else {
    postFromTopLevelPip({ type: 'pip-closing', time, id, paused });
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
    postFromTopLevelPip({ type: 'pip-state', time, paused, id });
  }
}
