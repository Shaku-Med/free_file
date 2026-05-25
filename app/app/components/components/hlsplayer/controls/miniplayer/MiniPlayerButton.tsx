import { PanelBottom } from 'lucide-react';
import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router';
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
  const { activateMiniPlayer, getNavigateBackTarget } = useMiniPlayerContext();
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    const video = videoRef.current;
    if (!video || !file) return;

    const backTarget = getNavigateBackTarget();

    flushSync(() => {
      activateMiniPlayer(
        {
          // `src` is always populated when this button is clickable (the
          // active player has a src). Fallback exists only as a defensive
          // guard for off-spec callers; it returns the legacy proxy URL,
          // which the LoadPlay-aware getVideoSrc(playbackUrl=undefined)
          // path handles gracefully.
          src: src || getVideoSrc(file.endpoint ?? '', file.file_type),
          file,
          imageID: imageID || file.unique_id,
        },
        { navigateTo: backTarget }
      );
    });
    navigate(backTarget);
  }, [videoRef, src, file, imageID, activateMiniPlayer, getNavigateBackTarget, navigate]);

  if (isReel || !file) return null;

  return (
    <Tooltip delayDuration={350}>
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
