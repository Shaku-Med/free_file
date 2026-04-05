import { usePlayerContext } from '../../PlayerContext';
import { useRemotePlayback } from '../../hooks/useRemotePlayback';
import AirPlayIcon from './CastIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function CastButton() {
  const { videoRef } = usePlayerContext();
  const { isAvailable, isCasting, prompt } = useRemotePlayback(videoRef);

  if (!isAvailable) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={prompt}
          className={`relative p-1.5 rounded-md transition-colors ${
            isCasting
              ? 'text-blue-400 bg-blue-400/10 hover:bg-blue-400/20'
              : 'text-white hover:bg-white/10'
          }`}
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
