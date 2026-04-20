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
