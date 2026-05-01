import { Subtitles } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import { cn } from '~/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function SubtitleButton({ variant }: { variant?: 'mobileOverlay' | 'desktopPill' }) {
  const { state, setSubtitleTrack } = usePlayerContext();

  if (state.subtitleTracks.length === 0) return null;

  const isActive = state.currentSubtitleTrack !== -1;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isActive) {
      setSubtitleTrack(-1);
    } else {
      setSubtitleTrack(0);
    }
  };

  const label = isActive ? 'Turn off subtitles' : 'Turn on subtitles';

  if (variant === 'mobileOverlay') {
    return (
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            className={cn(
              'flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg border border-white/35 bg-black/50 px-2 text-xs font-bold tracking-wide text-white backdrop-blur-sm active:bg-black/60',
              isActive && 'border-primary text-primary'
            )}
            aria-label={label}
          >
            CC
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Subtitles (CC)</TooltipContent>
      </Tooltip>
    );
  }

  if (variant === 'desktopPill') {
    return (
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            className={cn(
              'flex h-8 min-w-[1.75rem] items-center justify-center rounded-md border border-white/25 px-1.5 text-[10px] font-bold tracking-wide text-white transition-colors hover:bg-white/10',
              isActive && 'border-primary text-primary'
            )}
            aria-label={label}
          >
            CC
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Subtitles (CC)</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip delayDuration={350}>
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
      <TooltipContent side="top">Subtitles (CC)</TooltipContent>
    </Tooltip>
  );
}
