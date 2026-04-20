import { PictureInPicture2 } from 'lucide-react';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { usePlayerContext } from '../PlayerContext';

export default function PipOverlay() {
  const { videoRef, src, imageID, file, loop } = usePlayerContext();
  const { isPipActive, isContentInPip, toggleDocumentPip } = usePictureInPictureContext();

  if (!isPipActive) return null;

  if (isContentInPip(imageID)) {
    return (
      <div
        onClick={() => toggleDocumentPip(src, videoRef, imageID, file, loop)}
        className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-2 bg-black/75 backdrop-blur-sm cursor-pointer hover:bg-black/65 transition-colors"
      >
        <PictureInPicture2 className="w-12 h-12 text-white" />
        <p className="text-white text-base font-medium">Playing in Picture-in-Picture</p>
        <p className="text-white/60 text-sm">Click to exit</p>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-2 bg-black/75 backdrop-blur-sm pointer-events-none"
      aria-live="polite"
    >
      <PictureInPicture2 className="w-12 h-12 text-amber-200/90" />
      <p className="text-white text-base font-medium text-center px-4">Another video is in Picture-in-Picture</p>
      <p className="text-white/60 text-sm text-center px-6 max-w-sm">
        This player stays paused until that video exits PiP.
      </p>
    </div>
  );
}
