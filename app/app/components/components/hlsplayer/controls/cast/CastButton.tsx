import { cn } from '~/lib/utils';
import { usePlayerContext } from '../../PlayerContext';
import { useRemotePlayback } from '../../hooks/useRemotePlayback';
import AirPlayIcon from './CastIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function CastButton({
  controlPill = false,
  mobileOverlay = false,
}: {
  controlPill?: boolean;
  mobileOverlay?: boolean;
}) {
  const { videoRef } = usePlayerContext();
  const { isAvailable, isCasting, prompt } = useRemotePlayback(videoRef);

  if (!isAvailable) return null;

  const runPrompt = () => {
    void prompt();
  };

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            if (mobileOverlay) e.stopPropagation();
            runPrompt();
          }}
          className={cn(
            'relative transition-colors',
            mobileOverlay &&
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-black/50 text-white shadow-sm backdrop-blur-sm active:bg-black/60',
            !mobileOverlay &&
              cn(
                controlPill ? 'rounded-lg p-2' : 'rounded-md p-1.5',
                isCasting
                  ? 'bg-blue-400/10 text-blue-400 hover:bg-blue-400/20'
                  : 'text-white hover:bg-white/10'
              ),
            mobileOverlay &&
              isCasting &&
              'border-blue-400/40 bg-black/60 text-blue-400'
          )}
          aria-label={isCasting ? 'Connected to device' : 'Cast to device'}
        >
          <AirPlayIcon className="w-5 h-5" />
          {isCasting && (
            <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {isCasting ? 'Connected – tap to disconnect' : 'Cast to TV or other device'}
      </TooltipContent>
    </Tooltip>
  );
}
