import { useRef, useState, useCallback } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import { useVideoHasAudio } from '../../hooks/useVideoHasAudio';

interface VolumeControlProps {
  showSlider?: boolean;
}

export default function VolumeControl({ showSlider = true }: VolumeControlProps) {
  const { state, setVolume, toggleMute, videoRef, hlsRef, src } = usePlayerContext();
  const hasAudioTrack = useVideoHasAudio(videoRef, hlsRef, src);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const canExpand = hasAudioTrack && showSlider && (isHovered || isDragging);

  const VolumeIcon = state.isMuted || state.volume === 0
    ? VolumeX
    : state.volume < 0.5
      ? Volume1
      : Volume2;

  const getVolFromX = useCallback((clientX: number) => {
    const el = sliderRef.current;
    if (!el) return state.volume;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [state.volume]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setVolume(getVolFromX(e.clientX));
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) setVolume(getVolFromX(e.clientX));
  };

  const handlePointerUp = () => setIsDragging(false);

  const displayVol = state.isMuted ? 0 : state.volume;

  return (
    <div
      className="flex items-center gap-1 group/vol"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setIsDragging(false); }}
    >
      <button
        type="button"
        onClick={() => hasAudioTrack && toggleMute()}
        disabled={!hasAudioTrack}
        title={hasAudioTrack ? undefined : 'No audio on this video'}
        className="p-1.5 rounded-md transition-colors text-white disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-white/10"
        aria-label={
          hasAudioTrack
            ? state.isMuted
              ? 'Unmute'
              : 'Mute'
            : 'No audio track'
        }
      >
        <VolumeIcon className="w-5 h-5" />
      </button>

      <div
        className="overflow-hidden transition-[width,opacity] duration-200"
        style={{ width: canExpand ? 80 : 0, opacity: canExpand ? 1 : 0 }}
        aria-hidden={!showSlider || !hasAudioTrack}
      >
        <div
          ref={sliderRef}
          className="relative h-2 w-full cursor-pointer select-none rounded-full overflow-hidden bg-secondary"
          onPointerDown={hasAudioTrack ? handlePointerDown : undefined}
          onPointerMove={hasAudioTrack ? handlePointerMove : undefined}
          onPointerUp={hasAudioTrack ? handlePointerUp : undefined}
        >
          <div
            className="absolute top-0 left-0 h-full bg-primary rounded-full"
            style={{ width: `${displayVol * 100}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-primary bg-background shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ left: `calc(${displayVol * 100}% - 8px)` }}
          />
        </div>
      </div>
    </div>
  );
}
