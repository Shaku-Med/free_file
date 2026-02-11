import { useEffect } from 'react';
import { usePlayerContext } from '../PlayerContext';

export function useFullscreen() {
  const { containerRef, setState } = usePlayerContext();

  useEffect(() => {
    const onChange = () => {
      setState(s => ({ ...s, isFullscreen: !!document.fullscreenElement }));
    };

    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [setState]);
}
