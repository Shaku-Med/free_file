import { useEffect } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { windappFullscreenBridge } from '~/lib/hooks/useWindapp';

export function useFullscreen() {
  const { setState } = usePlayerContext();

  useEffect(() => {
    // Desktop app: fullscreen is the native OS window, reported over IPC.
    // Toggle a root class so the app chrome (navbar / bottom tab bar, which
    // sit ABOVE the anchored player in z-order) hides while fullscreen.
    const bridge = windappFullscreenBridge();
    if (bridge?.onFullscreenChange) {
      const off = bridge.onFullscreenChange((on) => {
        setState((s) => ({ ...s, isFullscreen: on }));
        document.documentElement.classList.toggle('windapp-fullscreen', on);
      });
      return () => {
        off();
        document.documentElement.classList.remove('windapp-fullscreen');
      };
    }

    // Browser: HTML5 Fullscreen API.
    const onChange = () => {
      setState((s) => ({ ...s, isFullscreen: !!document.fullscreenElement }));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [setState]);
}
