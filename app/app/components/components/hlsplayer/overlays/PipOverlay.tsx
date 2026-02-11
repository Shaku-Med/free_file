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
        className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm cursor-pointer hover:bg-black/60 transition-colors"
      >
        <PictureInPicture2 className="w-12 h-12 text-white" />
        <p className="text-white text-base font-medium">Playing in Picture-in-Picture</p>
        <p className="text-white/60 text-sm">Click to exit</p>
      </div>
    );
  }

  return (
    <div className="absolute top-3 left-3 z-30 bg-amber-500/80 text-white px-3 py-1 rounded-lg text-xs font-medium backdrop-blur-sm">
      Another video is in PiP
    </div>
  );
}
