import { Maximize, Minimize } from 'lucide-react';
import { cn } from '~/lib/utils';
import { usePlayerContext } from '../../PlayerContext';
import { mobileOverlayCircleBtn, mobileOverlayIcon } from '../mobileControlMetrics';import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function FullscreenButton({ variant }: { variant?: 'mobileOverlay' | 'controlPill' }) {
  const { state, toggleFullscreen } = usePlayerContext();
  const label = state.isFullscreen ? 'Exit fullscreen' : 'Fullscreen';

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
          }}
          className={cn(
            variant === 'mobileOverlay'
              ? mobileOverlayCircleBtn
              : variant === 'controlPill'
                ? 'rounded-full p-2 text-white transition-colors hover:bg-white/10'
                : 'p-1.5 rounded-md hover:bg-white/10 transition-colors text-white',
          )}
          aria-label={label}
        >
          {state.isFullscreen ? (
            <Minimize className={variant === 'mobileOverlay' ? mobileOverlayIcon : 'w-5 h-5'} />
          ) : (
            <Maximize className={variant === 'mobileOverlay' ? mobileOverlayIcon : 'w-5 h-5'} />
          )}        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
