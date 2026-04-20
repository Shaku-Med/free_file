import { PanelBottom } from 'lucide-react';
import { useCallback } from 'react';
import { cn } from '~/lib/utils';
import { usePlayerContext } from '../../PlayerContext';
import { useMiniPlayerContext } from '~/lib/Context/MiniPlayerContext';
import { getVideoSrc } from '~/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function MiniPlayerButton({
  controlPill = false,
  mobileOverlay = false,
}: {
  controlPill?: boolean;
  mobileOverlay?: boolean;
}) {
  const { videoRef, src, imageID, file, isReel } = usePlayerContext();
  const { activateMiniPlayer, getNavigateBackTarget, sourceVideoRef } = useMiniPlayerContext();

  const handleClick = useCallback(() => {
    const video = videoRef.current;
    if (!video || !file) return;

    const backTarget = getNavigateBackTarget();

    sourceVideoRef.current = video;

    activateMiniPlayer(
      {
        src: src || getVideoSrc(file.endpoint ?? '', file.file_type),
        file,
        currentTime: video.currentTime,
        imageID: imageID || file.unique_id,
        wasPlaying: !video.paused,
        volume: video.volume,
        muted: video.muted,
        playbackRate: video.playbackRate,
      },
      { navigateTo: backTarget }
    );
  }, [videoRef, src, file, imageID, activateMiniPlayer, getNavigateBackTarget, sourceVideoRef]);

  if (isReel || !file) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            if (mobileOverlay) e.stopPropagation();
            handleClick();
          }}
          className={cn(
            'text-white transition-colors',
            mobileOverlay &&
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-black/50 shadow-sm backdrop-blur-sm active:bg-black/60',
            !mobileOverlay &&
              cn(
                controlPill ? 'rounded-lg p-2 hover:bg-white/10' : 'rounded-md p-1.5 hover:bg-white/10'
              )
          )}
          aria-label="Mini player"
        >
          <PanelBottom className="w-5 h-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Mini player</TooltipContent>
    </Tooltip>
  );
}
