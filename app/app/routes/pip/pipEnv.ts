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
  | { type: 'pip-command'; command: 'closing'; time: number; id: string };

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

export function requestPipClosingHandshake(time: number, id: string) {
  if (typeof window === 'undefined' || !PIP_MESSAGE_ORIGIN) return;
  const msg: PipCommandMessage = { type: 'pip-command', command: 'closing', time, id };
  if (window.parent !== window) {
    window.parent.postMessage(msg, PIP_MESSAGE_ORIGIN);
  } else {
    getOpenerForPipHandshake()?.postMessage({ type: 'pip-closing', time, id }, PIP_MESSAGE_ORIGIN);
  }
}
