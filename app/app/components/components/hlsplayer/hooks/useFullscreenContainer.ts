import { useEffect, useState } from 'react';

/**
 * The element currently in fullscreen (standard + webkit), or null.
 *
 * Use it as a portal `container` for menus/dropdowns rendered from the player
 * controls: while an element is fullscreen, anything portaled to document.body
 * is NOT visible  only the fullscreen element's own subtree renders. Portaling
 * into the fullscreen element keeps the settings/overflow menus reachable
 * without leaving fullscreen.
 */
export function useFullscreenContainer(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const read = () => {
      const fsEl =
        (document.fullscreenElement as HTMLElement | null) ??
        ((document as unknown as { webkitFullscreenElement?: HTMLElement | null })
          .webkitFullscreenElement ?? null);
      setEl(fsEl);
    };
    read();
    document.addEventListener('fullscreenchange', read);
    document.addEventListener('webkitfullscreenchange', read);
    return () => {
      document.removeEventListener('fullscreenchange', read);
      document.removeEventListener('webkitfullscreenchange', read);
    };
  }, []);
  return el;
}
