import { PictureInPicture2 } from 'lucide-react';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { usePlayerContext } from '../../PlayerContext';

export default function PipButton() {
  const { videoRef, src, imageID, file, loop } = usePlayerContext();
  const { supportsPip, toggleDocumentPip } = usePictureInPictureContext();

  if (!supportsPip) return null;

  const handleClick = () => {
    toggleDocumentPip(src, videoRef, imageID, file, loop);
  };

  return (
    <button
      onClick={handleClick}
      className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white"
      aria-label="Picture in Picture"
    >
      <PictureInPicture2 className="w-5 h-5" />
    </button>
  );
}
