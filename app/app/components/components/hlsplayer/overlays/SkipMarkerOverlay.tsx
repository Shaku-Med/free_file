import { useEffect, useMemo } from 'react';
import { SkipForward, FastForward } from 'lucide-react';
import { usePlayerContext } from '../PlayerContext';
import type { FileType } from '~/lib/types';

export interface SkipMarkers {
  introStart: number | null;
  introEnd: number | null;
  creditsStart: number | null;
}

interface SkipMarkerOverlayProps {
  markers: SkipMarkers;
  onSkipIntro: (jumpToSeconds: number) => void;
  onNextEpisode?: () => void;
  nextEpisode?: FileType | null;
  /** Notifies parent when one of the buttons is showing so the regular control bar can be dimmed. */
  onActiveChange?: (active: boolean) => void;
}

const SKIP_INTRO_LEAD_IN = 0.25; // small grace so the button doesn't pop in mid-frame

export default function SkipMarkerOverlay({
  markers,
  onSkipIntro,
  onNextEpisode,
  nextEpisode,
  onActiveChange,
}: SkipMarkerOverlayProps) {
  const { state, authPlaybackFeatures } = usePlayerContext();
  const t = state.currentTime;

  // Skip Intro and Next Episode are signed-in features (sit alongside autoplay /
  // ambient mode / audio visualizer in the same auth-gated bucket). Guest viewers
  // see neither button.
  const showSkipIntro = useMemo(() => {
    if (!authPlaybackFeatures) return false;
    if (markers.introStart == null || markers.introEnd == null) return false;
    if (markers.introEnd <= markers.introStart) return false;
    return t >= markers.introStart - SKIP_INTRO_LEAD_IN && t < markers.introEnd;
  }, [authPlaybackFeatures, markers.introStart, markers.introEnd, t]);

  const showNextEpisode = useMemo(() => {
    if (!authPlaybackFeatures) return false;
    if (markers.creditsStart == null) return false;
    if (!onNextEpisode || !nextEpisode) return false;
    return t >= markers.creditsStart;
  }, [authPlaybackFeatures, markers.creditsStart, t, onNextEpisode, nextEpisode]);

  const active = showSkipIntro || showNextEpisode;

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  if (!active) return null;

  return (
    <div className="absolute bottom-6 right-6 z-[32] flex flex-col items-end gap-2 pointer-events-none">
      {showSkipIntro && (
        <button
          type="button"
          onClick={() => onSkipIntro(markers.introEnd ?? 0)}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-md bg-white/95 px-5 py-2.5 text-sm font-semibold text-black shadow-lg backdrop-blur transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          <FastForward className="h-4 w-4" />
          Skip Intro
        </button>
      )}
      {showNextEpisode && (
        <button
          type="button"
          onClick={() => onNextEpisode?.()}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-md bg-white/95 px-5 py-2.5 text-sm font-semibold text-black shadow-lg backdrop-blur transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          <SkipForward className="h-4 w-4" />
          Next Episode
        </button>
      )}
    </div>
  );
}
