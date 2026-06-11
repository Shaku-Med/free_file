import { useEffect, useState, type RefObject } from 'react';
import { usePlayerContext } from '../../PlayerContext';
import LegacyCanvasConfetti from './LegacyCanvasConfetti';
import StemCssConfetti from './StemCssConfetti';

type BassConfettiProps = {
  analyser: AnalyserNode | null;
  anchorRef?: RefObject<HTMLElement | null>;
};

/**
 * Visualizer confetti: CSS + JS when audio_stems.json exists (per-instrument
 * colors + toggles). Canvas + live analyser fallback for older uploads.
 */
export default function BassConfetti({ analyser, anchorRef }: BassConfettiProps) {
  const { visualizerConfetti, audioStems } = usePlayerContext();
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    if (!visualizerConfetti) {
      setPortalReady(false);
      return;
    }
    setPortalReady(true);
    return () => setPortalReady(false);
  }, [visualizerConfetti]);

  if (!portalReady || !visualizerConfetti) return null;

  if (audioStems) {
    return <StemCssConfetti stems={audioStems} anchorRef={anchorRef} />;
  }

  return <LegacyCanvasConfetti analyser={analyser} anchorRef={anchorRef} />;
}
