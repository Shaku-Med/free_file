import { PictureInPicture2 } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function PipButton() {
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
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white"
          aria-label="Picture-in-Picture"
        >
          <PictureInPicture2 className="w-5 h-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Picture-in-Picture</TooltipContent>
    </Tooltip>
  );
}
