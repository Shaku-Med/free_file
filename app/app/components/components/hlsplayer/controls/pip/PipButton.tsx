import { PictureInPicture2 } from 'lucide-react';
import { cn } from '~/lib/utils';
import { usePlayerContext } from '../../PlayerContext';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function PipButton({ controlPill = false }: { controlPill?: boolean }) {
  const { videoRef, src, imageID, file, loop, isReel } = usePlayerContext();
  const { supportsPip, isContentInPip, toggleDocumentPip } = usePictureInPictureContext();

  if (!supportsPip || isReel) return null;
  if (isContentInPip(imageID)) return null; // Already in PiP - overlay handles exit

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => toggleDocumentPip(src, videoRef, imageID, file, loop)}
          className={cn(
            'text-white transition-colors',
            controlPill ? 'rounded-lg p-2 hover:bg-white/10' : 'rounded-md p-1.5 hover:bg-white/10'
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
