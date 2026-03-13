import { Cast } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import { useRemotePlayback } from '../../hooks/useRemotePlayback';
import AirPlayIcon from './CastIcon';

export default function CastButton() {
  const { videoRef } = usePlayerContext();
  const { isAvailable, isCasting, prompt } = useRemotePlayback(videoRef);

  if (!isAvailable) return null;

  return (
    <button
      onClick={prompt}
      className={`p-1.5 rounded-md hover:bg-white/10 transition-colors ${
        isCasting ? 'text-blue-400' : 'text-white'
      }`}
      aria-label={isCasting ? 'Connected to device' : 'Cast to device'}
      title={isCasting ? 'Connected – tap to disconnect' : 'Cast to TV or other device'}
    >
      <AirPlayIcon className="w-5 h-5" />
    </button>
  );
}