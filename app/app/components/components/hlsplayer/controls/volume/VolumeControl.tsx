import { useRef, useState, useCallback, useEffect } from 'react';
import { Volume2, Volume1, VolumeX } from '~/components/icons';
import { usePlayerContext } from '../../PlayerContext';
import { useVideoHasAudio } from '../../hooks/useVideoHasAudio';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { cn } from '~/lib/utils';

interface VolumeControlProps {
  showSlider?: boolean;
  barPill?: boolean;
  expandWithTap?: boolean;
  /** Use `--hls-ctrl-icon` from the mobile control bar. */
  mobileScaledIcons?: boolean;
}

export default function VolumeControl({
  showSlider = true,
  barPill = false,
  expandWithTap = false,
  mobileScaledIcons = false,
}: VolumeControlProps) {
  const { state, setVolume, toggleMute, videoRef, hlsRef, src, file } = usePlayerContext();
  // Read the upload-time has_audio flag (waveform analysis)  when the
  // server says the track is silent, the volume button has no purpose
  // even though the stream technically contains an audio channel.
  const serverHasAudio = (() => {
    const audio = (file?.metadata as { audio?: { has_audio?: boolean } } | undefined)?.audio;
    if (!audio || typeof audio.has_audio !== 'boolean') return null;
    return audio.has_audio;
  })();
  const hasAudioTrack = useVideoHasAudio(videoRef, hlsRef, src, serverHasAudio);
  const sliderRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [tapOpen, setTapOpen] = useState(false);
  const canExpand =
    hasAudioTrack &&
    showSlider &&
    (isHovered || isDragging || (expandWithTap && tapOpen));

  useEffect(() => {
    if (!expandWithTap || !tapOpen) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setTapOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [expandWithTap, tapOpen]);

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

  const iconClass = mobileScaledIcons
    ? 'h-[var(--hls-ctrl-icon,1.25rem)] w-[var(--hls-ctrl-icon,1.25rem)]'
    : 'w-5 h-5';
  const pillBtnStyle = mobileScaledIcons
    ? {
        padding: 'calc(var(--hls-ctrl-pill-px, 0.5rem) * 0.35)',
      }
    : undefined;
  const pillBtnPad = mobileScaledIcons ? undefined : 'p-2';

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-1 group/vol"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsDragging(false);
        setTapOpen(false);
      }}
      onTouchStart={(e) => {
        if (!expandWithTap || !showSlider || !hasAudioTrack) return;
        e.stopPropagation();
        setTapOpen(true);
      }}
    >
      {hasAudioTrack ? (
        <Tooltip delayDuration={350}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => toggleMute()}
              className={
                barPill
                  ? cn('rounded-full text-white transition-colors hover:bg-white/10', pillBtnPad)
                  : 'p-1.5 rounded-md transition-colors text-white hover:bg-white/10'
              }
              style={barPill ? pillBtnStyle : undefined}
              aria-label={state.isMuted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon className={iconClass} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {state.isMuted ? 'Unmute' : 'Mute'}
            {!state.isMuted && state.volume > 0 ? ` (${Math.round(state.volume * 100)}%)` : ''}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <button
                type="button"
                disabled
                className={
                  barPill
                    ? cn('cursor-not-allowed rounded-full text-white opacity-40 transition-colors', pillBtnPad)
                    : 'p-1.5 rounded-md transition-colors text-white opacity-40 cursor-not-allowed'
                }
                style={barPill ? pillBtnStyle : undefined}
                aria-label="No audio track"
              >
                <VolumeIcon className={iconClass} />
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">No audio on this video</TooltipContent>
        </Tooltip>
      )}

      <div
        className="overflow-hidden transition-[width,opacity] duration-200"
        style={{ width: canExpand ? 80 : 0, opacity: canExpand ? 1 : 0 }}
        aria-hidden={!showSlider || !hasAudioTrack}
      >
        <div
          ref={sliderRef}
          className="relative h-2 w-full cursor-pointer select-none rounded-full overflow-hidden bg-white/20"
          onPointerDown={hasAudioTrack ? handlePointerDown : undefined}
          onPointerMove={hasAudioTrack ? handlePointerMove : undefined}
          onPointerUp={hasAudioTrack ? handlePointerUp : undefined}
        >
          <div
            className="absolute top-0 left-0 h-full bg-white rounded-full"
            style={{ width: `${displayVol * 100}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ left: `calc(${displayVol * 100}% - 8px)` }}
          />
        </div>
      </div>
    </div>
  );
}
