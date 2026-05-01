import { PictureInPicture2 } from 'lucide-react';
import { cn } from '~/lib/utils';
import { usePlayerContext } from '../../PlayerContext';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function PipButton({
  controlPill = false,
  mobileOverlay = false,
}: {
  controlPill?: boolean;
  mobileOverlay?: boolean;
}) {
  const { videoRef, src, imageID, file, loop, isReel } = usePlayerContext();
  const { supportsPip, isContentInPip, toggleDocumentPip } = usePictureInPictureContext();

  if (!supportsPip || isReel) return null;
  if (isContentInPip(imageID)) return null;

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            if (mobileOverlay) e.stopPropagation();
            void toggleDocumentPip(src, videoRef, imageID, file, loop);
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
          aria-label="Picture-in-Picture"
        >
          <PictureInPicture2 className="w-5 h-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Picture-in-Picture</TooltipContent>
    </Tooltip>
  );
}
