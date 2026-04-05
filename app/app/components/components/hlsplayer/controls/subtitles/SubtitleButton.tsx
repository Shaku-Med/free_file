import { Subtitles } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import { cn } from '~/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function SubtitleButton() {
  const { state, setSubtitleTrack } = usePlayerContext();

  if (state.subtitleTracks.length === 0) return null;

  const isActive = state.currentSubtitleTrack !== -1;

  const handleClick = () => {
    if (isActive) {
      setSubtitleTrack(-1);
    } else {
      setSubtitleTrack(0);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'p-1.5 rounded-md hover:bg-white/10 transition-colors',
            isActive ? 'text-primary' : 'text-white'
          )}
          aria-label={isActive ? 'Turn off subtitles' : 'Turn on subtitles'}
        >
          <Subtitles className="w-5 h-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Subtitles</TooltipContent>
    </Tooltip>
  );
}
